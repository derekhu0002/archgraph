// EA headless bootstrap (AT-2100-OPT-05).
// Run via cscript (SysWOW64 JScript): creates EA.Repository, OpenFile(an isolated feap
// copy), injects a Session shim + JSON shim + headless override globals, then evals the
// target script (its bottom main() auto-runs).
//
// Usage (wrapped by run-headless.ps1):
//   cscript //nologo bootstrap.js /feap:<copy> /script:<js> /mode:import|export
//             [/graph:<json>] [/output:<json>] [/diagram:<id>] [/response:<file>] [/log:<file>]

var FSO = new ActiveXObject('Scripting.FileSystemObject');

function posArg(i, dflt) {
  try {
    var v = WScript.Arguments(i);
    if (v !== null && typeof v != 'undefined' && v != '' && v != '-') { return '' + v; }
  } catch (e) { }
  return dflt;
}

// Positional: feap script mode graph output diagram response log parent
var FEAP = posArg(0, '');
var SCRIPT = posArg(1, '');
var MODE = posArg(2, '');
var GRAPH = posArg(3, '');
var OUTPUT = posArg(4, '');
var DIAGRAM = posArg(5, '');
var RESPONSE = posArg(6, '');
var LOG = posArg(7, '');
var PARENT = posArg(8, '');

var LOG_LINES = [];
function writeLog(msg) {
  LOG_LINES.push(msg);
  if (LOG != '') {
    try {
      var s = FSO.CreateTextFile(LOG, true, false);
      s.WriteLine(LOG_LINES.join('\r\n'));
      s.Close();
    } catch (e) { }
  }
  try { WScript.Echo(msg); } catch (e) { }
}

// Read next line from the response file (skip blank and #-prefixed). 'delete' supports
// deletion confirmation; other prompts default to the safe value.
var _respLines = null;
var _respIdx = 0;
function nextResponse(defaultValue) {
  if (_respLines == null) {
    _respLines = [];
    try {
      if (RESPONSE != '' && FSO.FileExists(RESPONSE)) {
        var ts = FSO.OpenTextFile(RESPONSE, 1, false);
        var all = ts.ReadAll();
        ts.Close();
        var arr = all.split(/\r\n|\r|\n/);
        for (var i = 0; i < arr.length; i++) {
          var t = arr[i].replace(/^\s+|\s+$/g, '');
          if (t != '' && t.charAt(0) != '#') { _respLines.push(t); }
        }
      }
    } catch (e) { }
  }
  if (_respIdx < _respLines.length) {
    var ans = _respLines[_respIdx];
    _respIdx = _respIdx + 1;
    return ans;
  }
  return defaultValue == null ? '' : '' + defaultValue;
}

var Session = {
  Output: function (msg) { writeLog('' + msg); },
  Input: function (prompt, defaultValue) { writeLog('Session.Input prompt: ' + prompt); return nextResponse(defaultValue); },
  Prompt: function (prompt, buttons) { writeLog('Session.Prompt: ' + prompt); return 7; }
};

// JSON shim for cscript JScript 5.8.
if (typeof JSON == 'undefined') {
  var JSON = {
    parse: function (text) {
      return eval('(' + text + ')');
    },
    stringify: function (value) {
      function esc(s) {
        return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
      }
      function enc(v) {
        if (v === null || typeof v == 'undefined') { return 'null'; }
        var t = typeof v;
        if (t == 'string') { return esc(v); }
        if (t == 'number' || t == 'boolean') { return '' + v; }
        if (Object.prototype.toString.apply(v) == '[object Array]') {
          var a = [];
          for (var i = 0; i < v.length; i++) { a.push(enc(v[i])); }
          return '[' + a.join(',') + ']';
        }
        var o = [];
        for (var k in v) {
          if (v.hasOwnProperty(k)) { o.push(esc(k) + ':' + enc(v[k])); }
        }
        return '{' + o.join(',') + '}';
      }
      return enc(value);
    }
  };
}

function readTextFile(p) {
  if (p == '' || !FSO.FileExists(p)) { return ''; }
  var st = new ActiveXObject('ADODB.Stream');
  st.Type = 2;
  st.Charset = 'utf-8';
  st.Open();
  st.LoadFromFile(p);
  var text = st.ReadText();
  st.Close();
  return text.replace(/^\uFEFF/, '');
}

function parseRowNums(xml, tag) {
  var out = [];
  var re = new RegExp('<' + tag + '>(\\d+)</' + tag + '>', 'gi');
  var m;
  while ((m = re.exec(xml)) != null) { out.push(parseInt(m[1], 10)); }
  return out;
}

// Pick an export root diagram inside the sync package (prefer schema_view_id=429).
function pickSyncDiagram(r) {
  var pkgIds = [];
  try {
    pkgIds = parseRowNums('' + r.SQLQuery("SELECT Package_ID FROM t_package WHERE Name='ArchGraph Sync'"), 'Package_ID');
  } catch (e) { pkgIds = []; }
  var pkgId = pkgIds.length > 0 ? pkgIds[0] : 0;
  var where = pkgId != 0 ? ' WHERE Package_ID=' + pkgId : '';
  var target = scanDiagrams(r, where, '429');
  if (target != 0) { return target; }
  // fallback 1: any diagram in the package
  target = scanDiagrams(r, where, '');
  if (target != 0) { return target; }
  // fallback 2: any diagram in the model (root-level preferred)
  target = scanDiagrams(r, '', '429');
  if (target != 0) { return target; }
  return scanDiagrams(r, '', '');
}

function scanDiagrams(r, where, prefViewId) {
  var listXml = '';
  try {
    listXml = '' + r.SQLQuery('SELECT Diagram_ID, StyleEx FROM t_diagram' + where);
  } catch (e) { listXml = ''; }
  var fallback = 0;
  var rowRe = /<Row>([\s\S]*?)<\/Row>/gi;
  var rm;
  while ((rm = rowRe.exec(listXml)) != null) {
    var didM = /<DIAGRAM_ID>(\d+)<\/DIAGRAM_ID>/i.exec(rm[1]);
    if (!didM) { continue; }
    var id = parseInt(didM[1], 10);
    if (fallback == 0) { fallback = id; }
    if (prefViewId != '' && rm[1].indexOf('schema_view_id=' + prefViewId) >= 0) { return id; }
  }
  return fallback;
}

function run() {
  writeLog('headless-bootstrap feap=' + FEAP + ' script=' + SCRIPT + ' mode=' + MODE);
  if (FEAP == '' || SCRIPT == '' || (MODE != 'import' && MODE != 'export')) {
    writeLog('ERROR: feap/script/mode required');
    WScript.Quit(2);
  }
  if (!FSO.FileExists(FEAP)) { writeLog('ERROR: feap not found: ' + FEAP); WScript.Quit(2); }
  if (!FSO.FileExists(SCRIPT)) { writeLog('ERROR: script not found: ' + SCRIPT); WScript.Quit(2); }

  var repo = null;
  try {
    repo = new ActiveXObject('EA.Repository');
  } catch (e) {
    writeLog('ERROR: cannot create EA.Repository: ' + e.message);
    WScript.Quit(3);
  }
  var opened = false;
  try {
    opened = repo.OpenFile(FEAP);
  } catch (e) {
    writeLog('ERROR: OpenFile threw: ' + e.message);
    WScript.Quit(3);
  }
  if (!opened) {
    writeLog('ERROR: OpenFile returned false for ' + FEAP);
    WScript.Quit(3);
  }
  writeLog('OpenFile OK');
  var Repository = repo;

  // Headless override globals consumed by import/export patches.
  if (GRAPH != '') { EA_HEADLESS_GRAPH = GRAPH; }
  if (PARENT != '') { EA_HEADLESS_PARENT_PKG = PARENT; }
  if (OUTPUT != '') { EA_HEADLESS_OUTPUT = OUTPUT; }
  if (DIAGRAM != '') { EA_HEADLESS_DIAGRAM_ID = parseInt(DIAGRAM, 10) || 0; }

  if (MODE == 'export') {
    var diagramId = 0;
    try { diagramId = parseInt(DIAGRAM, 10) || 0; } catch (e) { diagramId = 0; }
    if (diagramId == 0) {
      diagramId = pickSyncDiagram(repo);
      writeLog('auto diagramId=' + diagramId);
    }
    if (diagramId != 0) {
      EA_HEADLESS_DIAGRAM_ID = diagramId;
      try {
        Repository.OpenDiagram(diagramId);
        writeLog('OpenDiagram OK id=' + diagramId);
      } catch (e) {
        writeLog('WARN OpenDiagram failed: ' + e.message);
      }
    }
  }

  var source = readTextFile(SCRIPT);
  if (source == '') { writeLog('ERROR: script empty'); WScript.Quit(2); }
  // Drop EA !INC boot lines (JScript 5.8 has no Array#filter).
  var srcLines = source.split(/\r?\n/);
  var filteredLines = [];
  for (var li = 0; li < srcLines.length; li++) {
    if (srcLines[li].replace(/^\s+/, '').indexOf('!INC ') != 0) {
      filteredLines.push(srcLines[li]);
    }
  }
  source = filteredLines.join('\n');
  // Strip EA JScript type annotations (var x as EA.Diagram; is invalid in cscript JScript).
  source = source.replace(/\bas\s+EA\.[A-Za-z0-9_\.]+/g, '');

  var exitCode = 0;
  try {
    eval(source);
  } catch (e) {
    writeLog('ERROR: eval/run threw: ' + e.message + ' number=' + e.number);
    exitCode = 1;
  }
  try { repo.CloseFile(); } catch (e) { }
  try { repo.Exit(); } catch (e) { }
  writeLog('HEADLESS_' + MODE.toUpperCase() + '_' + (exitCode == 0 ? 'OK' : 'FAIL'));
  WScript.Quit(exitCode);
}

// Headless override globals (declared after use in run() to rely on hoisting; eval shares scope).
var EA_HEADLESS_GRAPH = '';
var EA_HEADLESS_PARENT_PKG = '';
var EA_HEADLESS_OUTPUT = '';
var EA_HEADLESS_DIAGRAM_ID = 0;

run();
