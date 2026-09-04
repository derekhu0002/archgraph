function arg(i,d){ try{ var v=WScript.Arguments(i); if(v!=null&&v!=''){return ''+v;} }catch(e){} return d; }
function P(m){ try{ WScript.Echo('['+new Date().getTime()+'] '+m); }catch(e){} }
var FEAP = arg(0,''); P('feap='+FEAP);
var repo = new ActiveXObject('EA.Repository');
P('open='+repo.OpenFile(FEAP));
function count(sql){ try{ var x=''+repo.SQLQuery(sql); var m=x.split('<Row>').length-1; return m; }catch(e){ return 'ERR:'+e.message; } }
function head(sql, tag){ try{ var x=''+repo.SQLQuery(sql); var i=x.indexOf('<Row>'); var j=x.indexOf('</Row>'); return (i>=0? x.substring(i, j+6) : '(none)'); }catch(e){ return 'ERR:'+e.message; } }
P('t_package rows='+count('SELECT Package_ID FROM t_package'));
P('t_diagram rows='+count('SELECT Diagram_ID FROM t_diagram'));
P('diag head='+head('SELECT Diagram_ID, Name FROM t_diagram','Diagram_ID'));
P('t_object rows='+count('SELECT Object_ID FROM t_object'));
var pkg = repo.GetPackageByID(1);
P('root package='+(pkg?pkg.Name:'null')+' diagrams='+(pkg?pkg.Diagrams.Count:-1));
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
