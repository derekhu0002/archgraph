function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') { return '' + v; } } catch (e) { } return d; }
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
var FEAP = arg(0, '');
P('feap=' + FEAP);
var repo = new ActiveXObject('EA.Repository');
P('open=' + repo.OpenFile(FEAP));
function runQuery(sql) { try { return '' + repo.SQLQuery(sql); } catch (e) { return 'ERR:' + e.message; } }
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
function countAliases(prefix) {
  var xml = runQuery("SELECT COUNT(*) AS C FROM t_object WHERE Alias LIKE '" + prefix + "%'");
  var m = /<C>(\d+)<\/C>/i.exec(xml);
  return m ? m[1] : '?';
}
function guid(p, i) {
  var g = p + '-' + ('00000' + i).slice(-5);
  return '{' + g + '-1111-2222-3333-444444444444}';
}
function oneRow(prefix, i) {
  return "INSERT INTO t_object (OBJECT_TYPE,NAME,ALIAS,EA_GUID,PACKAGE_ID,PARENTID,STATUS) VALUES ('Class','" + prefix + i + "','" + prefix + i + "','" + guid(prefix, i) + "',85,0,'Proposed')";
}
// control single
exec(oneRow('ctl_', 1), 'control-single');
P('count ctl_ = ' + countAliases('ctl_'));
// two statements separated by ';' in one Execute
exec(oneRow('semi_', 1) + ';' + oneRow('semi_', 2), 'semicolon-two');
P('count semi_ = ' + countAliases('semi_'));
// EXECUTE BLOCK with 2 inserts
function block(prefix, n) {
  var stmts = [];
  for (var i = 0; i < n; i++) { stmts.push(oneRow(prefix, i)); }
  return 'EXECUTE BLOCK AS BEGIN ' + stmts.join('; ') + '; END';
}
exec(block('blk2_', 2), 'block-2');
P('count blk2_ = ' + countAliases('blk2_'));
exec(block('blk100_', 100), 'block-100');
P('count blk100_ = ' + countAliases('blk100_'));
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
