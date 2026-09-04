// Minimal EA COM probe (headless debug). cscript //nologo probe.js <feap>
var FSO = new ActiveXObject('Scripting.FileSystemObject');
var FEAP = '';
try { FEAP = WScript.Arguments(0); } catch (e) { }
function L(m) { try { WScript.Echo(m); } catch (e) { } }
function readText(p) { var st = new ActiveXObject('ADODB.Stream'); st.Type=2; st.Charset='utf-8'; st.Open(); st.LoadFromFile(p); var t=st.ReadText(); st.Close(); return t.replace(/^\uFEFF/,''); }
function esc(v){ return (''+v).replace(/'/g,"''"); }
L('feap=' + FEAP);
var repo = new ActiveXObject('EA.Repository');
L('OpenFile=' + repo.OpenFile(FEAP));
L('--- t_package rows:');
L('' + repo.SQLQuery('SELECT Package_ID, ea_guid, Name, Parent_ID FROM t_package'));
L('--- execute test UPDATE t_object (no-op set Name=Name):');
try { L('exec1=' + repo.Execute('UPDATE t_object SET Name=Name WHERE Object_ID=1')); } catch (e) { L('exec1 throw=' + e.message); }
L('--- execute test INSERT INTO t_object (minimal):');
var g = '{' + new Date().getTime() + '-0000-4000-8000-00000000dead}';
var sql = "INSERT INTO t_object (Object_Type, ea_guid, Name, Type, Package_ID) VALUES ('Object', '" + esc(g) + "', 'ProbeTmp', 'Class', 1)";
L('sql=' + sql);
try { L('exec2=' + repo.Execute(sql)); } catch (e) { L('exec2 throw=' + e.message); }
L('--- readback by guid:');
L('' + repo.SQLQuery("SELECT Object_ID FROM t_object WHERE ea_guid='" + esc(g) + "'"));
L('--- delete probe row:');
try { L('exec3=' + repo.Execute("DELETE FROM t_object WHERE ea_guid='" + esc(g) + "'")); } catch (e) { L('exec3 throw=' + e.message); }
try { repo.CloseFile(); repo.Exit(); } catch (e) { }
WScript.Quit(0);
