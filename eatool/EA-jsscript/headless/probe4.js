// probe4.js — duplicate attribute name capability. cscript probe4.js <feap>
function arg(i,d){ try{ var v=WScript.Arguments(i); if(v!=null&&v!='') return ''+v; }catch(e){} return d; }
var FEAP = arg(0,'');
function P(m){ try{ WScript.Echo('['+new Date().getTime()+'] '+m);}catch(e){} }
P('feap='+FEAP);
var repo = new ActiveXObject('EA.Repository');
P('OpenFile='+repo.OpenFile(FEAP));
var pkg = repo.GetPackageByID(1);
var el = pkg.Elements.AddNew('DupAttrProbe','Class');
el.Update();
P('element id='+el.ElementID);
var a1 = el.Attributes.AddNew('commit','String'); a1.Default='aaa'; a1.Notes='desc1'; a1.Update();
var a2 = el.Attributes.AddNew('commit','String'); a2.Default='bbb'; a2.Notes='desc2'; a2.Update();
P('added two same-name attrs');
el.Attributes.Refresh();
P('attr count='+el.Attributes.Count);
for (var i=0;i<el.Attributes.Count;i++){ var a=el.Attributes.GetAt(i); P('  attr['+i+'] name='+a.Name+' default='+a.Default+' notes='+a.Notes); }
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
