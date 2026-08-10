const cfg = window.JARVIS_CONFIG || {};
let sb = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let activeStream = null;
let audioContext = null;
let analyser = null;
let meterRAF = null;
let recordingStartedAt = 0;

const $ = (id) => document.getElementById(id);
const fmt = (iso) => iso ? new Date(iso).toLocaleString("de-DE", {dateStyle:"medium", timeStyle:"short"}) : "ohne Termin";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
let deferredInstallPrompt = null;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function hideSplash(){
  const splash = $("splash");
  if(!splash) return;
  setTimeout(()=>splash.classList.add("hide"), 350);
}

window.addEventListener("beforeinstallprompt", (event)=>{
  event.preventDefault();
  deferredInstallPrompt = event;
  if(!isStandalone()) $("installBtn")?.classList.remove("hidden");
});

window.addEventListener("appinstalled", ()=>{
  deferredInstallPrompt = null;
  $("installBtn")?.classList.add("hidden");
});

function showInstallHelp(text){
  $("installHelpText").textContent = text;
  const dlg = $("installHelp");
  if(dlg?.showModal) dlg.showModal();
}

$("installBtn")?.addEventListener("click", async ()=>{
  if(isStandalone()) return;
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("installBtn").classList.add("hidden");
    return;
  }
  if(isIOS()) showInstallHelp("In Safari unten auf Teilen tippen und anschließend ‘Zum Home-Bildschirm’ wählen.");
  else showInstallHelp("Öffne das Browser-Menü und wähle ‘App installieren’ oder ‘Zum Startbildschirm hinzufügen’. Falls die Option noch fehlt, lade die Seite einmal neu.");
});
$("installHelpClose")?.addEventListener("click", ()=>$("installHelp")?.close());

if(!isStandalone()) setTimeout(()=>$("installBtn")?.classList.remove("hidden"), 1200);
setTimeout(hideSplash, 1800);


function setConn(ok, text=ok?"CLOUD ONLINE":"OFFLINE"){
  const b=$("connectionBadge"); b.textContent=text; b.className="badge "+(ok?"online":"offline");
}
function reply(t, speak=false){
  $("assistantReply").textContent=t;
  if(speak) speakText(t);
}

function speakText(text){
  if(!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE";
  u.rate = 1.0;
  window.speechSynthesis.speak(u);
}

async function init(){
  if(!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("HIER_") ||
     !cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_PUBLISHABLE_KEY.includes("HIER_")){
    $("loginStatus").textContent="Bitte zuerst config.js mit Project URL und Publishable Key ausfüllen.";
    hideSplash();
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth:{persistSession:true, autoRefreshToken:true}
  });

  const {data:{session}} = await sb.auth.getSession();
  if(session) await enterApp(session.user);
  else showLogin();

  sb.auth.onAuthStateChange(async (_event, session)=>{
    if(session) await enterApp(session.user); else showLogin();
  });
  hideSplash();
}

function showLogin(){
  $("loginPanel").classList.remove("hidden");
  $("appPanel").classList.add("hidden");
  setConn(false);
}

async function enterApp(user){
  $("loginPanel").classList.add("hidden");
  $("appPanel").classList.remove("hidden");
  setConn(true);
  $("userInfo").innerHTML=`E-Mail: ${esc(user.email)}<br>User-ID: ${esc(user.id)}`;
  await Promise.all([loadMemory(), loadReminders(), loadWaste()]);
  await refreshMicrophones();
}

$("loginBtn").addEventListener("click", async ()=>{
  if(!sb) return;
  $("loginStatus").textContent="Authentifiziere …";
  const {error}=await sb.auth.signInWithPassword({email:$("email").value.trim(), password:$("password").value});
  $("loginStatus").textContent=error ? "Fehler: "+error.message : "Anmeldung erfolgreich.";
});

$("logoutBtn").addEventListener("click", async ()=>{ if(sb) await sb.auth.signOut(); });

async function loadMemory(){
  const {data,error}=await sb.from("jarvis_memory").select("id,subject,content,created_at").order("created_at",{ascending:false}).limit(20);
  if(error){ $("memoryList").innerHTML=`<div class="item">Fehler: ${esc(error.message)}</div>`; return; }
  $("memoryList").innerHTML=(data||[]).map(x=>`<div class="item"><b>${esc(x.subject||"Memory")}</b><br>${esc(x.content)}<br><small>${fmt(x.created_at)}</small></div>`).join("") || `<div class="item">Noch keine Einträge.</div>`;
}
$("memorySaveBtn").addEventListener("click", async ()=>{
  const content=$("memoryContent").value.trim(); if(!content) return;
  const {error}=await sb.from("jarvis_memory").insert({subject:$("memorySubject").value.trim()||null, content, category:"mobile"});
  if(error) return reply("Cloud-Memory Fehler: "+error.message);
  $("memoryContent").value=""; reply("Ist gespeichert und mit der Cloud synchronisiert.", true); await loadMemory();
});

async function loadReminders(){
  const {data,error}=await sb.from("jarvis_reminders").select("id,title,due_at,completed,created_at").eq("completed",false).order("due_at",{ascending:true}).limit(20);
  if(error){ $("reminderList").innerHTML=`<div class="item">Fehler: ${esc(error.message)}</div>`; return; }
  $("reminderList").innerHTML=(data||[]).map(x=>`<div class="item"><b>${esc(x.title)}</b><br><small>${fmt(x.due_at)}</small></div>`).join("") || `<div class="item">Keine offenen Erinnerungen.</div>`;
}
$("reminderSaveBtn").addEventListener("click", async ()=>{
  const title=$("reminderTitle").value.trim(), raw=$("reminderDue").value; if(!title||!raw) return;
  const due = new Date(raw).toISOString();
  const {error}=await sb.from("jarvis_reminders").insert({title, due_at:due, completed:false});
  if(error) return reply("Reminder-Fehler: "+error.message);
  $("reminderTitle").value=""; reply("Erinnerung in der Cloud gespeichert.", true); await loadReminders();
});

const wasteNames = {altpapier:"Blaue Tonne",gelb:"Gelbe Tonne",bio:"Braune Tonne",restabfall:"Graue Tonne"};
async function loadWaste(){
  const today=new Date(); today.setHours(0,0,0,0);
  const iso=today.toISOString().slice(0,10);
  const {data,error}=await sb.from("waste_calendar").select("waste_type,collection_date,address").gte("collection_date",iso).order("collection_date",{ascending:true}).limit(12);
  if(error){ $("wasteNext").textContent="Fehler: "+error.message; return; }
  if(!data?.length){ $("wasteNext").textContent="Keine kommenden Termine gefunden."; $("wasteList").innerHTML=""; return; }
  const first=data[0], d=new Date(first.collection_date+"T12:00:00");
  $("wasteNext").textContent=`Als Nächstes: ${wasteNames[first.waste_type]||first.waste_type} am ${d.toLocaleDateString("de-DE",{weekday:"long",day:"2-digit",month:"long"})}.`;
  $("wasteList").innerHTML=data.slice(0,8).map(x=>{
    const dd=new Date(x.collection_date+"T12:00:00");
    return `<div class="item">${esc(wasteNames[x.waste_type]||x.waste_type)} <small>${dd.toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"})}</small></div>`;
  }).join("");
}


const DEFAULT_WEATHER_LOCATION = "Viersen";

function weatherCodeText(code){
  const c = Number(code);
  if(c === 0) return "klar";
  if([1,2].includes(c)) return "leicht bewölkt";
  if(c === 3) return "bewölkt";
  if([45,48].includes(c)) return "neblig";
  if([51,53,55,56,57].includes(c)) return "mit Nieselregen";
  if([61,63,65,66,67].includes(c)) return "regnerisch";
  if([71,73,75,77].includes(c)) return "mit Schneefall";
  if([80,81,82].includes(c)) return "mit Regenschauern";
  if([85,86].includes(c)) return "mit Schneeschauern";
  if([95,96,99].includes(c)) return "mit Gewittern";
  return "wechselhaft";
}

async function getWeather(location=DEFAULT_WEATHER_LOCATION, dayOffset=0){
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", location);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("language", "de");
  geoUrl.searchParams.set("format", "json");

  const geoResp = await fetch(geoUrl);
  if(!geoResp.ok) throw new Error("Ortsauflösung fehlgeschlagen");
  const geo = await geoResp.json();
  const place = geo?.results?.[0];
  if(!place) throw new Error(`Ort ${location} nicht gefunden`);

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", place.latitude);
  forecastUrl.searchParams.set("longitude", place.longitude);
  forecastUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max");
  forecastUrl.searchParams.set("timezone", "Europe/Berlin");
  forecastUrl.searchParams.set("forecast_days", "3");

  const r = await fetch(forecastUrl);
  if(!r.ok) throw new Error("Wetterdienst nicht erreichbar");
  const data = await r.json();

  const d = data.daily || {};
  const i = Math.max(0, Math.min(dayOffset, (d.time?.length || 1) - 1));
  const condition = weatherCodeText(d.weather_code?.[i]);

  return {
    location: place.name || location,
    date: d.time?.[i],
    condition,
    min: Math.round(d.temperature_2m_min?.[i]),
    max: Math.round(d.temperature_2m_max?.[i]),
    rainProb: Math.round(d.precipitation_probability_max?.[i] ?? 0),
    rain: Number(d.precipitation_sum?.[i] ?? 0),
    wind: Math.round(d.wind_speed_10m_max?.[i] ?? 0)
  };
}

function weatherReply(w, label){
  const rainText = w.rainProb <= 10 && w.rain < 0.1
    ? "Regen ist nicht zu erwarten."
    : `Die Regenwahrscheinlichkeit liegt bei maximal ${w.rainProb} Prozent.`;

  return `${label} wird es in ${w.location} ${w.condition} bei ${w.min} bis ${w.max} Grad. ${rainText} Der Wind erreicht etwa ${w.wind} Kilometer pro Stunde.`;
}

async function handleCommand(raw){
  const t=raw.trim(); if(!t) return;
  const n=t.toLowerCase();

  let m=n.match(/^merke dir(?:,)?(?: dass)?\s+(.+)$/i);
  if(m){
    const content=m[1].trim();
    const {error}=await sb.from("jarvis_memory").insert({content,category:"mobile"});
    if(error) return reply("Fehler beim Speichern: "+error.message, true);
    reply("Ist gespeichert und mit der Cloud synchronisiert.", true); await loadMemory(); return;
  }

  if(n.includes("blaue tonne") || n.includes("papier")){
    const today=new Date().toISOString().slice(0,10);
    const {data,error}=await sb.from("waste_calendar").select("collection_date").eq("waste_type","altpapier").gte("collection_date",today).order("collection_date",{ascending:true}).limit(1);
    if(error||!data?.length) return reply("Ich finde aktuell keinen Termin.", true);
    const d=new Date(data[0].collection_date+"T12:00:00");
    reply(`Die blaue Tonne wird das nächste Mal am ${d.toLocaleDateString("de-DE",{weekday:"long",day:"2-digit",month:"long"})} abgeholt.`, true); return;
  }

  if(n.includes("welche tonne") && n.includes("nächst")){
    await loadWaste(); reply($("wasteNext").textContent, true); return;
  }

  if(n.includes("was weißt du über")){
    const q=t.split(/über/i).slice(1).join("über").trim();
    const safeQ=q.replace(/[(),]/g," ");
    const {data,error}=await sb.from("jarvis_memory").select("subject,content").or(`subject.ilike.%${safeQ}%,content.ilike.%${safeQ}%`).limit(10);
    if(error) return reply("Memory-Abfrage fehlgeschlagen.", true);
    reply(data?.length ? data.map(x=>x.content).join(" ") : `Ich habe aktuell nichts über ${q} gespeichert.`, true); return;
  }

  if(n.includes("wetter")){
    try{
      $("systemStatus").textContent="WEATHER DATA";
      const tomorrow = n.includes("morgen");
      const w = await getWeather(DEFAULT_WEATHER_LOCATION, tomorrow ? 1 : 0);
      reply(weatherReply(w, tomorrow ? "Morgen" : "Heute"), true);
    }catch(err){
      console.error("[JARVIS WEATHER]", err);
      reply("Ich konnte die Wetterdaten gerade nicht abrufen.", true);
    }finally{
      $("systemStatus").textContent="SYSTEMS NOMINAL";
    }
    return;
  }

  reply("Dieser mobile Befehl ist noch nicht im Router hinterlegt.", true);
}

$("sendBtn").addEventListener("click", async ()=>{ const v=$("commandInput").value; $("commandInput").value=""; await handleCommand(v); });
$("commandInput").addEventListener("keydown", e=>{if(e.key==="Enter") $("sendBtn").click();});


async function refreshMicrophones(){
  if(!navigator.mediaDevices?.enumerateDevices) return;
  try{
    // Labels are normally hidden until microphone permission has been granted once.
    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some(d => d.kind === "audioinput" && d.label);

    if(!hasLabels){
      try{
        const permissionStream = await navigator.mediaDevices.getUserMedia({audio:true});
        permissionStream.getTracks().forEach(t=>t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      }catch(_){}
    }

    const inputs = devices.filter(d => d.kind === "audioinput");
    const select = $("micSelect");
    const previous = localStorage.getItem("jarvis_mic_device") || "";
    select.innerHTML = '<option value="">Standardmikrofon</option>';

    for(const d of inputs){
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Mikrofon ${select.options.length}`;
      select.appendChild(opt);
    }

    if(previous && [...select.options].some(o => o.value === previous)){
      select.value = previous;
    }else{
      // Prefer the user's known W8GS microphone when Chrome exposes it.
      const w8 = inputs.find(d => /W8GS/i.test(d.label || ""));
      if(w8) select.value = w8.deviceId;
    }
  }catch(err){
    console.warn("[JARVIS MIC] enumerateDevices:", err);
  }
}

$("micSelect").addEventListener("change", ()=>{
  localStorage.setItem("jarvis_mic_device", $("micSelect").value || "");
});

function startLevelMeter(stream){
  stopLevelMeter();
  try{
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    const draw = ()=>{
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for(const v of data){
        const x = (v - 128) / 128;
        sum += x*x;
      }
      const rms = Math.sqrt(sum/data.length);
      const pct = Math.min(100, Math.round(rms * 450));
      $("micLevel").style.width = `${pct}%`;
      $("micLevelText").textContent = `MIC ${pct}%`;
      meterRAF = requestAnimationFrame(draw);
    };
    draw();
  }catch(err){
    console.warn("[JARVIS MIC] level meter:", err);
  }
}

function stopLevelMeter(){
  if(meterRAF) cancelAnimationFrame(meterRAF);
  meterRAF = null;
  if(audioContext){
    audioContext.close().catch(()=>{});
    audioContext = null;
  }
  analyser = null;
  $("micLevel").style.width = "0%";
  $("micLevelText").textContent = "MIC 0%";
}

async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia){
    reply("Mikrofonzugriff ist hier nicht verfügbar. Für das Handy brauchen wir HTTPS.", true);
    return;
  }
  try{
    const selectedDevice = $("micSelect").value;
    const audioConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
    if(selectedDevice) audioConstraints.deviceId = {exact:selectedDevice};

    activeStream = await navigator.mediaDevices.getUserMedia({audio:audioConstraints});

    const track = activeStream.getAudioTracks()[0];
    console.log("[JARVIS MIC] track:", {
      label: track?.label,
      settings: track?.getSettings?.()
    });

    startLevelMeter(activeStream);

    const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");

    mediaRecorder = preferred
      ? new MediaRecorder(activeStream,{mimeType:preferred,audioBitsPerSecond:64000})
      : new MediaRecorder(activeStream);

    audioChunks=[];
    recordingStartedAt = performance.now();

    mediaRecorder.ondataavailable=e=>{
      if(e.data && e.data.size>0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop=async ()=>{
      const duration = Math.max(0, (performance.now()-recordingStartedAt)/1000);
      stopLevelMeter();
      activeStream?.getTracks().forEach(t=>t.stop());
      activeStream=null;

      const mime = mediaRecorder.mimeType || preferred || "audio/webm";
      const blob = new Blob(audioChunks,{type:mime});

      console.log("[JARVIS MIC] recording:", {
        seconds: Number(duration.toFixed(2)),
        bytes: blob.size,
        mime,
        chunks: audioChunks.length
      });

      if(duration < 0.8){
        reply("Die Aufnahme war zu kurz. Mikrofon drücken, sprechen und danach erneut drücken.", true);
        $("systemStatus").textContent="SYSTEMS NOMINAL";
        return;
      }
      if(blob.size < 1500){
        reply("Die Mikrofonaufnahme enthält praktisch keine Audiodaten. Bitte oben das richtige Mikrofon auswählen.", true);
        $("systemStatus").textContent="SYSTEMS NOMINAL";
        return;
      }

      await transcribeBlob(blob);
    };

    // Emit chunks regularly; this is more robust across Chrome/Edge versions.
    mediaRecorder.start(250);
    isRecording=true;
    $("micBtn").textContent="■";
    $("micBtn").classList.add("recording");
    $("systemStatus").textContent="LISTENING";
    reply(`Ich höre … ${track?.label ? "(" + track.label + ")" : ""}`);
  }catch(err){
    stopLevelMeter();
    activeStream?.getTracks().forEach(t=>t.stop());
    activeStream=null;
    reply("Mikrofonfehler: "+err.message, true);
  }
}

async function stopRecording(){
  if(mediaRecorder && isRecording){
    isRecording=false;
    $("micBtn").textContent="🎙";
    $("micBtn").classList.remove("recording");
    $("systemStatus").textContent="TRANSCRIBING";
    // requestData ensures the final buffered packet is emitted before stop.
    try{ mediaRecorder.requestData(); }catch(_){}
    setTimeout(()=>mediaRecorder.stop(), 120);
  }
}

async function transcribeBlob(blob){
  try{
    reply("Transkribiere …");
    const fd=new FormData();
    fd.append("file", blob, "jarvis-mobile.webm");

    const {data,error}=await sb.functions.invoke("jarvis-stt",{body:fd});
    if(error) {
      console.error("[JARVIS STT] invoke error:", error);
      throw new Error(error.message || "Edge Function konnte nicht aufgerufen werden");
    }

    console.log("[JARVIS STT] response:", data);

    if(data?.error){
      throw new Error(data.error);
    }

    const text=(data?.text||"").trim();
    if(!text){
      throw new Error("Leere Transkription – Edge Function antwortet, liefert aber kein text-Feld. Öffne F12 → Console und prüfe '[JARVIS STT] response'.");
    }
    $("commandInput").value=text;
    $("systemStatus").textContent="PROCESSING";
    reply(`Du: ${text}`);
    await handleCommand(text);
  }catch(err){
    reply("STT-Fehler: "+(err?.message||String(err)), true);
  }finally{
    $("systemStatus").textContent="SYSTEMS NOMINAL";
  }
}

$("micBtn").addEventListener("click", async ()=>{
  if(isRecording) await stopRecording(); else await startRecording();
});

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js"));
init();
