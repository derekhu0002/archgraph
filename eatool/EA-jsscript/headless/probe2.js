// probe2.js — focused t_object INSERT diagnostics (bounded). cscript probe2.js <feap> <variant>
// variant: A=minimal(no Object_ID) B=explicit big Object_ID C=COMMIT+minimal D=explicit small E=UPDATE existing
var FSO = new ActiveXObject('Scripting.FileSystemObject');
function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') return '' + v; } catch (e) { } return d; }
var FEAP = arg(0, '');
var VARIANT = arg(1, 'A').toUpperCase();
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
function esc(v) { return ('' + v).replace(/'/g, "''"); }
P('feap=' + FEAP + ' variant=' + VARIANT);
var repo = new ActiveXObject('EA.Repository');
P('OpenFile=' + repo.OpenFile(FEAP));
P('before-count=' + ('' + repo.SQLQuery('SELECT COUNT(*) AS N FROM t_object')).replace(/[\s\S]*?<N>(\d+)<\/N>[\s\S]*/, '$1'));

var guid = '{DIAG' + Math.floor(Math.random() * 1e9).toString(16) + '0000-4000-8000-00000000d1a9}';
var sql = '';
if (VARIANT == 'A') {
  sql = "INSERT INTO t_object (Object_Type, ea_guid, Name, Type, Package_ID) VALUES ('Object', '" + esc(guid) + "', 'DiagProbe', 'Class', 1)";
} else if (VARIANT == 'B') {
  sql = "INSERT INTO t_object (Object_ID, Object_Type, ea_guid, Name, Type, Package_ID) VALUES (999999001, 'Object', '" + esc(guid) + "', 'DiagProbe', 'Class', 1)";
} else if (VARIANT == 'C') {
  repo.Execute('COMMIT');
  P('committed');
  sql = "INSERT INTO t_object (Object_Type, ea_guid, Name, Type, Package_ID) VALUES ('Object', '" + esc(guid) + "', 'DiagProbe', 'Class', 1)";
} else if (VARIANT == 'D') {
  sql = "INSERT INTO t_object (Object_ID, Object_Type, ea_guid, Name, Type, Package_ID) VALUES (900001, 'Object', '" + esc(guid) + "', 'DiagProbe', 'Class', 1)";
} else if (VARIANT == 'E') {
  sql = "UPDATE t_object SET Name = 'DiagUpdated' WHERE Object_ID = 1";
} else {
  sql = '';
}
P('sql=' + sql);
var began = new Date().getTime();
var okv;
try { okv = repo.Execute(sql); } catch (e) { P('THROW=' + e.message); okv = 'THROW'; }
P('elapsed_ms=' + (new Date().getTime() - began) + ' ret=' + okv);
if (VARIANT == 'A' || VARIANT == 'B' || VARIANT == 'D') {
  P('after-count=' + ('' + repo.SQLQuery('SELECT COUNT(*) AS N FROM t_object')).replace(/[\s\S]*?<N>(\d+)<\/N>[\s\S]*/, '$1'));
}
try { repo.CloseFile(); repo.Exit(); } catch (e) { }
P('done');
WScript.Quit(0);
