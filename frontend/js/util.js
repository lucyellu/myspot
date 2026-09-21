export function fmtDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${ss}`;
  }
  return `${m}:${ss}`;
}

export function fmtMonthYear(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function fmtAccount(name) {
  if (!name) return "—";
  name = name.replace(/^sunosync_?/, "");
  name = name.replace(/_\d{4}_[A-Za-z]+_\d{1,2}$/, "");
  return name || "main";
}

const _CH_PALETTE = ["#e84","#3ba","#b59","#fb0","#27c","#a53","#6c2","#d36","#c5b","#48a"];
export function channelColor(rawAccount) {
  const name = fmtAccount(rawAccount);
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return _CH_PALETTE[h % _CH_PALETTE.length];
}

const _channelDisplayNames = new Map();
const _channelAvatars = new Map();

export function setChannelDisplayNames(channels) {
  _channelDisplayNames.clear();
  _channelAvatars.clear();
  if (Array.isArray(channels)) {
    for (const c of channels) {
      if (c && c.account) {
        if (c.display_name) {
          _channelDisplayNames.set(c.account, c.display_name);
          _channelDisplayNames.set(fmtAccount(c.account), c.display_name);
        }
        if (c.avatar_url) {
          _channelAvatars.set(c.account, c.avatar_url);
          _channelAvatars.set(fmtAccount(c.account), c.avatar_url);
        }
      }
    }
  }
}

export function getChannelDisplayName(rawAccount) {
  if (!rawAccount) return "—";
  if (_channelDisplayNames.has(rawAccount)) {
    return _channelDisplayNames.get(rawAccount);
  }
  const clean = fmtAccount(rawAccount);
  if (_channelDisplayNames.has(clean)) {
    return _channelDisplayNames.get(clean);
  }
  return clean;
}

export function getChannelAvatar(rawAccount) {
  if (!rawAccount) return null;
  if (_channelAvatars.has(rawAccount)) {
    return _channelAvatars.get(rawAccount);
  }
  const clean = fmtAccount(rawAccount);
  if (_channelAvatars.has(clean)) {
    return _channelAvatars.get(clean);
  }
  return null;
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function toast(message, ms = 2400) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
