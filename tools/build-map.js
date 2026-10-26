const t=require('./node_modules/world-atlas/countries-110m.json');const tc=require('topojson-client');
const geoms=t.objects.countries.geometries;
const nb=tc.neighbors(geoms);
const rename={"United States of America":"United States","Dem. Rep. Congo":"DR Congo","Central African Rep.":"Central African Republic","Bosnia and Herz.":"Bosnia and Herzegovina","Macedonia":"North Macedonia","Dominican Rep.":"Dominican Republic","Eq. Guinea":"Equatorial Guinea","S. Sudan":"South Sudan","Solomon Is.":"Solomon Islands","Falkland Is.":"Falkland Islands","W. Sahara":"Western Sahara","eSwatini":"Eswatini","Congo":"Republic of the Congo","N. Cyprus":"Cyprus","Somaliland":"Somalia","Fr. S. Antarctic Lands":"French Southern Lands"};
const key=g=>rename[g.properties.name]||g.properties.name;
const S=1000/360, P=v=>Math.round(v*10)/10;
const out={}, order=[];
geoms.forEach((g,i)=>{
  const k=key(g); if(k==='Antarctica')return;
  const f=tc.feature(t,g);
  const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  let d='',b=out[k]?out[k].b:[1e9,1e9,-1e9,-1e9];let mb=out[k]?out[k].mb:null,ma=out[k]?out[k].ma:0;
  for(const poly of polys)for(const ring of poly){
    let prev=null,s='',rb=[1e9,1e9,-1e9,-1e9];
    let wrap=false;for(let j=1;j<ring.length;j++)if(Math.abs(ring[j][0]-ring[j-1][0])>180)wrap=true;
    ring.forEach(([lon,lat],j)=>{if(wrap&&lon<0)lon+=360;const x=P((lon+180)*S),y=P((90-lat)*S);const pt=x+' '+y;if(pt===prev)return;s+=(s?'L':'M')+pt;prev=pt;
      rb[0]=Math.min(rb[0],x);rb[1]=Math.min(rb[1],y);rb[2]=Math.max(rb[2],x);rb[3]=Math.max(rb[3],y);b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);});
    const a=(rb[2]-rb[0])*(rb[3]-rb[1]);if(a>ma){ma=a;mb=rb;}
    d+=s+'Z';}
  if(!out[k]){out[k]={d:'',b,n:new Set()};order.push(k);}
  out[k].d+=d; out[k].b=b; out[k].mb=mb; out[k].ma=ma;
  nb[i].forEach(j=>{const kk=key(geoms[j]);if(kk!==k&&kk!=='Antarctica')out[k].n.add(kk);});
});
const res=order.map(k=>({name:k,d:out[k].d,b:out[k].mb.map(P),n:[...out[k].n]}));
require('fs').writeFileSync('map.json',JSON.stringify(res));
console.log(res.length, JSON.stringify(res).length);
console.log(res.find(r=>r.name==='Georgia').n, res.find(r=>r.name==='France').n, res.find(r=>r.name==='Russia').b);
