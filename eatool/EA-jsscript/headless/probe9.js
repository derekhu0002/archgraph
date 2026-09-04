function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') { return '' + v; } } catch (e) { } return d; }
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
var FEAP = arg(0, '');
P('feap=' + FEAP);
var repo = new ActiveXObject('EA.Repository');
P('open=' + repo.OpenFile(FEAP));
function runQuery(sql) { try { return '' + repo.SQLQuery(sql); } catch (e) { return 'ERR:' + e.message; } }
function tags(xml, tag) { var out = []; var re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'gi'); var m; while ((m = re.exec(xml)) != null) { out.push(m[1].replace(/^\s+|\s+$/g, '')); } return out; }
function rowCols(rowHtml) { var cols = {}; var cm = new RegExp('<([A-Z][A-Z0-9_]*?)>([\\s\\S]*?)<\\/\\1>', 'g'); var m; while ((m = cm.exec(rowHtml)) != null) { cols[m[1]] = m[2].replace(/^\s+|\s+$/g, ''); } return cols; }
P('COLS T_OBJECTPROPERTIES :: ' + tags(runQuery("SELECT RDB$FIELD_NAME AS F FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME='T_OBJECTPROPERTIES' ORDER BY RDB$FIELD_POSITION"), 'F').join(', '));
P('COLS T_CONNECTORTAG :: ' + tags(runQuery("SELECT RDB$FIELD_NAME AS F FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME='T_CONNECTORTAG' ORDER BY RDB$FIELD_POSITION"), 'F').join(', '));
P('COLS T_TAGGEDVALUE :: ' + tags(runQuery("SELECT RDB$FIELD_NAME AS F FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME='T_TAGGEDVALUE' ORDER BY RDB$FIELD_POSITION"), 'F').join(', '));
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
