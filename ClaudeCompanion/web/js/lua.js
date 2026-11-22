// Reads a WoW SavedVariables file (Lua tables) into plain JS objects.
// Input is a "binary string" (one char per byte, e.g. from atob) so the
// game's \ddd byte escapes and raw UTF-8 both decode correctly.
(function (root) {
  function utf8(s) {
    if (!/[\x80-\xff]/.test(s)) return s;
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  function parse(text) {
    let i = 0;
    const n = text.length;
    const out = {};

    function ws() {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
        if (c === 45 && text.charCodeAt(i + 1) === 45) { // -- comment
          if (text.startsWith('--[[', i)) { const e = text.indexOf(']]', i); i = e < 0 ? n : e + 2; }
          else { const e = text.indexOf('\n', i); i = e < 0 ? n : e + 1; }
          continue;
        }
        break;
      }
    }

    function str() {
      const q = text[i++];
      let s = '';
      let start = i;
      while (i < n) {
        const c = text[i];
        if (c === q) { s += text.slice(start, i); i++; return utf8(s); }
        if (c === '\\') {
          s += text.slice(start, i);
          i++;
          const e = text[i++];
          if (e === 'n') s += '\n';
          else if (e === 't') s += '\t';
          else if (e === 'r') s += '\r';
          else if (e === 'a') s += '\x07';
          else if (e === 'b') s += '\b';
          else if (e === 'f') s += '\f';
          else if (e === 'v') s += '\v';
          else if (e >= '0' && e <= '9') {
            let d = e;
            while (d.length < 3 && text[i] >= '0' && text[i] <= '9') d += text[i++];
            s += String.fromCharCode(parseInt(d, 10));
          } else if (e === '\r') { s += '\n'; if (text[i] === '\n') i++; }
          else s += e; // \\ \" \' \n(newline)
          start = i;
        } else i++;
      }
      throw new Error('unterminated string');
    }

    function longStr() {
      // [[ ... ]] or [==[ ... ]==]
      const m = /^\[(=*)\[/.exec(text.slice(i, i + 20));
      const close = ']' + m[1] + ']';
      i += m[0].length;
      if (text[i] === '\n') i++;
      const e = text.indexOf(close, i);
      const s = text.slice(i, e < 0 ? n : e);
      i = e < 0 ? n : e + close.length;
      return utf8(s);
    }

    const numRe = /-?(?:0x[0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf|nan)/y;
    function value() {
      ws();
      const c = text[i];
      if (c === '{') return table();
      if (c === '"' || c === "'") return str();
      if (c === '[' && (text[i + 1] === '[' || text[i + 1] === '=')) return longStr();
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('nil', i)) { i += 3; return null; }
      numRe.lastIndex = i;
      const m = numRe.exec(text);
      if (m) {
        i += m[0].length;
        if (m[0].endsWith('inf')) return m[0][0] === '-' ? -Infinity : Infinity;
        if (m[0].endsWith('nan')) return NaN;
        return Number(m[0]);
      }
      throw new Error('unexpected "' + text.slice(i, i + 20) + '" at ' + i);
    }

    function table() {
      i++; // {
      const obj = {};
      let next = 1;
      let arrayOnly = true;
      for (;;) {
        ws();
        if (text[i] === '}') { i++; break; }
        let key;
        if (text[i] === '[' && text[i + 1] !== '[' && text[i + 1] !== '=') {
          i++;
          key = value();
          ws();
          if (text[i] !== ']') throw new Error('expected ] at ' + i);
          i++;
          ws();
          if (text[i] !== '=') throw new Error('expected = at ' + i);
          i++;
          const v = value();
          if (typeof key !== 'number') arrayOnly = false;
          obj[key] = v;
        } else {
          const save = i;
          const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 200));
          let named = false;
          if (id) {
            i += id[0].length;
            ws();
            if (text[i] === '=' && text[i + 1] !== '=') { i++; obj[id[0]] = value(); arrayOnly = false; named = true; }
            else i = save;
          }
          if (!named) obj[next++] = value();
        }
        ws();
        if (text[i] === ',' || text[i] === ';') i++;
      }
      if (arrayOnly) {
        const keys = Object.keys(obj);
        if (keys.length === 0) return {};
        const arr = [];
        for (let k = 1; k <= keys.length; k++) {
          if (!(k in obj)) return obj;
          arr.push(obj[k]);
        }
        return arr;
      }
      return obj;
    }

    for (;;) {
      ws();
      if (i >= n) break;
      const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(i, i + 200));
      if (!id) throw new Error('expected a name at ' + i);
      i += id[0].length;
      ws();
      if (text[i] !== '=') throw new Error('expected = after ' + id[0]);
      i++;
      out[id[0]] = value();
    }
    return out;
  }

  const api = { parse };
  if (typeof module !== 'undefined') module.exports = api;
  root.CCLua = api;
})(typeof window !== 'undefined' ? window : globalThis);
