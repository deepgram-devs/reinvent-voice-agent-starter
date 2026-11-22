// The operator console: watch one booth, pick who is visiting, start and end conversations, wrap up gracefully, and
// show the code QR. Everything goes through the server, which runs the conversation.

import { booth, connect, passcode, setPasscode } from "./common.js";

const $ = (id) => document.getElementById(id);
let st = {};

$("num").textContent = booth;
$("boothin").value = booth;
document.title = `Booth ${booth} console`;

function line(role, text) {
  const el = document.createElement("div");
  el.className = `line ${role}`;
  el.innerHTML = `<b>${{ user: "Visitor", agent: "Agent", tool: "Function", event: "Booth" }[role] || role}</b>`;
  el.append(text);
  $("log").append(el);
  el.scrollIntoView({ block: "end" });
}

function render() {
  const title = !st.stand ? "No booth screen" : !st.armed ? "Screen not set up" : st.ending ? "Saying goodbye"
    : st.closing ? "Wrapping up" : st.live ? "In conversation" : st.call ? "Connecting" : "Ready";
  $("title").textContent = title;
  $("sub").textContent = !st.stand ? `open /?booth=${booth} on the booth laptop`
    : !st.armed ? "click Set up on the booth screen" : st.role ? `role: ${st.role}` : "booth console";
  $("start").disabled = !st.armed || st.call;
  $("role").disabled = st.call;
  $("stop").disabled = !st.call;
  $("wrap").disabled = !st.live || st.closing || st.ending;
  $("qr").textContent = st.qr ? "Hide the code QR" : "Show the code QR";
  $("qr").classList.toggle("on", !!st.qr);
}

const server = connect("console", {
  onopen() { $("pass").classList.remove("show"); $("log").replaceChildren(); },
  onstatus(up) { if (!up) { st = {}; render(); $("title").textContent = "Offline"; } },
  onjson(msg) {
    if (msg.type === "status") { if (msg.call && st.booth && !st.call) $("log").replaceChildren(); st = msg; render(); }
    else if (msg.type === "roles") $("role").replaceChildren(...msg.roles.map((r) => new Option(r.label, r.id)));
    else if (msg.type === "line") line(msg.role, msg.text);
    else if (msg.type === "event") line("event", msg.text);
  },
  onrefused() {
    $("pass").classList.add("show");
    $("passerr").textContent = passcode() ? "That passcode is wrong." : "This booth needs a passcode.";
    $("title").textContent = "Locked";
  },
});

$("start").onclick = () => server.send({ type: "start", role: $("role").value });
$("stop").onclick = () => server.send({ type: "stop" });
$("wrap").onclick = () => server.send({ type: "wrap" });
$("qr").onclick = () => server.send({ type: "qr", on: !st.qr });
$("passgo").onclick = () => { setPasscode($("passin").value.trim()); server.reconnect(); };
$("switch").onsubmit = (e) => {
  e.preventDefault();
  const id = $("boothin").value.trim();
  if (id) location.search = `?booth=${encodeURIComponent(id)}`;
};
render();
