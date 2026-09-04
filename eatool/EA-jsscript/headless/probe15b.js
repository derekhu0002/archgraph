function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') { return '' + v; } } catch (e) { } return d; }
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
var FEAP = arg(0, '');
P('feap=' + FEAP);
var repo = new ActiveXObject('EA.Repository');
P('open=' + repo.OpenFile(FEAP));
function exec(sql, label) {
  try {
    var ok = repo.Execute(sql);
    P('EXEC ' + label + ' ok=' + ok + ' len=' + sql.length);
    return ok !== false;
  } catch (e) {
    P('EXECERR ' + label + ' :: ' + e.message + ' len=' + sql.length);
    return false;
  }
}
// harmless no-op UPDATE (0 rows): supported repos return without throw; SQLite fails?
exec("UPDATE t_object SET Status = Status WHERE Object_ID = -999999", 'update-noop');
// DDL temp table (any pass-through at all?)
exec("CREATE TABLE zz_probe_tmp (a INTEGER)", 'create-tmp-table');
// DELETE no-op
exec("DELETE FROM t_object WHERE Object_ID = -999999", 'delete-noop');
// SELECT through Execute (some EA builds support only selects)
exec("SELECT 1 AS X", 'select-via-execute');
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
