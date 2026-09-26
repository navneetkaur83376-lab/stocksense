const products = [
  {name:"Steel Rods",sku:"ST-001",category:"Raw Material",location:"Main Warehouse",stock:80,min:20,unit:"kg"},
  {name:"Office Chairs",sku:"CH-002",category:"Furniture",location:"Main Warehouse",stock:5,min:10,unit:"units"},
  {name:"Office Tables",sku:"TB-003",category:"Furniture",location:"Production Floor",stock:0,min:8,unit:"units"},
  {name:"Computer Systems",sku:"CP-004",category:"Electronics",location:"Main Warehouse",stock:25,min:10,unit:"units"},
  {name:"Keyboard",sku:"KB-005",category:"Electronics",location:"Main Warehouse",stock:7,min:12,unit:"units"},
  {name:"Mouse",sku:"MS-006",category:"Electronics",location:"Production Floor",stock:30,min:10,unit:"units"}
];

let searchTerm="", warehouse="all", stockStatus="all";

function statusFor(p){
  if(p.stock===0) return "out";
  if(p.stock<=p.min) return "low";
  return "in";
}
function statusLabel(s){ return s==="out" ? "OUT OF STOCK" : s==="low" ? "LOW STOCK" : "IN STOCK"; }

function renderRows(targetId){
  const body=document.getElementById(targetId);
  if(!body) return;
  const filtered=products.filter(p=>{
    const text=(p.name+" "+p.sku+" "+p.category).toLowerCase();
    const matchesSearch=text.includes(searchTerm.toLowerCase());
    const matchesWarehouse=warehouse==="all" || p.location===warehouse;
    const matchesStock=stockStatus==="all" || statusFor(p)===stockStatus;
    return matchesSearch && matchesWarehouse && matchesStock;
  });
  body.innerHTML=filtered.map(p=>{
    const s=statusFor(p);
    return `<tr>
      <td><div class="product-cell"><span class="product-icon">${p.sku.slice(0,2)}</span><div><b>${p.name}</b><small>${p.category}</small></div></div></td>
      <td><span class="sku">${p.sku}</span></td>
      ${targetId==="inventoryBody2" ? `<td>${p.category}</td>` : ""}
      <td><span class="location">${p.location}</span></td>
      <td><span class="qty">${p.stock} ${p.unit}</span></td>
      <td><span class="status ${s}">${statusLabel(s)}</span></td>
      ${targetId==="inventoryBody" ? `<td class="row-arrow">›</td>` : ""}
    </tr>`;
  }).join("") || `<tr><td colspan="7" style="padding:25px;text-align:center;color:#999">No matching inventory found.</td></tr>`;
}

function updateKPIs(){
  document.getElementById("totalUnits").textContent=products.reduce((a,p)=>a+p.stock,0);
  document.getElementById("lowCount").textContent=String(products.filter(p=>statusFor(p)==="low").length).padStart(2,"0");
  document.getElementById("outCount").textContent=String(products.filter(p=>statusFor(p)==="out").length).padStart(2,"0");
}

function renderInventory(){ renderRows("inventoryBody"); renderRows("inventoryBody2"); }
function syncSearch(v){ document.getElementById("globalSearch").value=v; document.getElementById("inventorySearch2").value=v; searchTerm=v; renderInventory(); }
function syncWarehouse(v){ document.getElementById("warehouseFilter").value=v; document.getElementById("warehouseFilter2").value=v; warehouse=v; renderInventory(); }
function syncStock(v){ document.getElementById("stockFilter").value=v; document.getElementById("stockFilter2").value=v; stockStatus=v; renderInventory(); }

function showSection(id){
  document.querySelectorAll(".page-section").forEach(s=>s.classList.remove("active-section"));
  document.getElementById(id).classList.add("active-section");
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.section===id));
  const labels={dashboard:"OVERVIEW",deliveries:"DELIVERY ORDERS",adjustments:"STOCK ADJUSTMENTS",inventory:"INVENTORY",warehouse:"WAREHOUSES",activity:"STOCK LEDGER"};
  document.getElementById("pageCrumb").textContent=labels[id]||"OVERVIEW";
  window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>showSection(btn.dataset.section)));

function fillProductSelects(){
  const options=products.map((p,i)=>`<option value="${i}">${p.sku} — ${p.name}</option>`).join("");
  document.getElementById("deliveryProduct").innerHTML=options;
  document.getElementById("adjustProduct").innerHTML=options;
  updateDeliveryPreview(); updateAdjustment();
}
function updateDeliveryPreview(){
  const i=Number(document.getElementById("deliveryProduct").value||0), p=products[i];
  const q=Math.max(0,Number(document.getElementById("deliveryQty").value||0));
  document.getElementById("deliveryAvailable").textContent=p.stock;
  document.getElementById("deliveryOutbound").textContent=q;
  document.getElementById("deliveryRemaining").textContent=Math.max(0,p.stock-q);
}
function validateDelivery(){
  const i=Number(document.getElementById("deliveryProduct").value), q=Number(document.getElementById("deliveryQty").value);
  const p=products[i];
  if(!q || q<1){return showMessage("deliveryMessage","Enter a valid quantity.",true)}
  if(q>p.stock){return showMessage("deliveryMessage",`Cannot validate: only ${p.stock} ${p.unit} available.`,true)}
  p.stock-=q;
  showMessage("deliveryMessage",`✓ ${q} ${p.unit} of ${p.name} validated. Stock reduced and ledger updated.`);
  updateKPIs(); renderInventory(); updateDeliveryPreview(); updateAdjustment();
}
function resetDelivery(){document.getElementById("deliveryQty").value=1;showSection("deliveries");updateDeliveryPreview();showMessage("deliveryMessage","")}
function setProcess(step){
  document.querySelectorAll(".process-step").forEach((el,i)=>el.classList.toggle("active",i<step));
  showMessage("deliveryMessage",step===2?"✓ Order marked as packed. Ready for validation.":"");
}
function updateAdjustment(){
  const i=Number(document.getElementById("adjustProduct").value||0), p=products[i];
  document.getElementById("recordedStock").value=p.stock;
  const physical=document.getElementById("physicalCount");
  if(document.activeElement!==physical) physical.value=p.stock;
  const diff=Number(physical.value||0)-p.stock;
  document.getElementById("difference").textContent=(diff>0?"+":"")+diff;
  const state=document.getElementById("differenceState");
  state.className=diff===0?"variance-neutral":diff>0?"variance-positive":"variance-negative";
  state.textContent=diff===0?"NO CHANGE":diff>0?"SURPLUS":"SHORTAGE";
}
function applyAdjustment(){
  const i=Number(document.getElementById("adjustProduct").value), p=products[i];
  const physical=Number(document.getElementById("physicalCount").value);
  if(!Number.isFinite(physical)||physical<0)return showMessage("adjustMessage","Enter a valid physical count.",true);
  const diff=physical-p.stock;
  p.stock=physical;
  showMessage("adjustMessage",`✓ Adjustment applied: ${diff>=0?"+":""}${diff} ${p.unit}. Stock ledger updated.`);
  updateKPIs();renderInventory();updateAdjustment();
}
function showMessage(id,msg,error=false){const el=document.getElementById(id);el.textContent=msg;el.style.color=error?"#d95748":"#2e9d6d"}

function tick(){
  const d=new Date();
  document.getElementById("clock").textContent=d.toLocaleTimeString("en-IN",{hour12:false});
}
setInterval(tick,1000);tick();

fillProductSelects();updateKPIs();renderInventory();
