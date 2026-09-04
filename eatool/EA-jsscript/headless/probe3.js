// probe3.js — headless object-model write smoke (EA object APIs). cscript probe3.js <feap>
var FSO = new ActiveXObject('Scripting.FileSystemObject');
function arg(i,d){ try{ var v=WScript.Arguments(i); if(v!=null&&v!='') return ''+v; }catch(e){} return d; }
var FEAP = arg(0,'');
function P(m){ try{ WScript.Echo('['+new Date().getTime()+'] '+m);}catch(e){} }
P('feap='+FEAP);
var repo = new ActiveXObject('EA.Repository');
P('OpenFile='+repo.OpenFile(FEAP));
function cnt(){ try{ var xml=''+repo.SQLQuery('SELECT COUNT(*) AS N FROM t_object'); var m=/<N>(\d+)<\/N>/.exec(xml); return m?parseInt(m[1],10):-1; }catch(e){ return -1; } }
var before=cnt();
P('before='+before);
try {
  var pkg = repo.GetPackageByID(1);
  var el = pkg.Elements.AddNew('ProbeHeadless','Class');
  el.Update();
  P('element id='+el.ElementID+' guid='+el.ElementGUID);
  var el2 = pkg.Elements.AddNew('ProbeHeadless2','Class');
  el2.Update();
  var con = el.Connectors.AddNew('depends','Dependency');
  con.SupplierID = el2.ElementID;
  con.Update();
  P('connector id='+con.ConnectorID);
  var dia = pkg.Diagrams.AddNew('ProbeDiagram','Logical');
  dia.Update();
  P('diagram id='+dia.DiagramID);
  var dobj = dia.DiagramObjects.AddNew('l=10;r=200;t=10;b=80;','');
  dobj.ElementID = el.ElementID;
  dobj.Update();
  dia.Update();
  P('diagram object added');
} catch(e){ P('THROW='+e.message); }
P('after='+cnt());
try{ repo.CloseFile(); repo.Exit(); }catch(e){}
P('done'); WScript.Quit(0);
