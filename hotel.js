const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const db = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  return neon(process.env.DATABASE_URL);
};
const num = v => Number(v || 0);
const round = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const clean = v => String(v == null ? '' : v).trim();
const fmt = v => v ? new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).replace(',', '') : '';
const id = prefix => `${prefix}/${Date.now()}/${Math.random().toString(36).slice(2,7).toUpperCase()}`;
const b64 = value => Buffer.from(value).toString('base64url');
const sign = value => crypto.createHmac('sha256', process.env.AUTH_SECRET || '').update(value).digest('base64url');
const safeEqual = (a,b) => {
  const x=Buffer.from(String(a)), y=Buffer.from(String(b));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
};
function makeSession() {
  const payload=b64(JSON.stringify({exp:Date.now()+12*60*60*1000}));
  return `${payload}.${sign(payload)}`;
}
function isAuthenticated(req) {
  if(!process.env.AUTH_SECRET) return false;
  const cookies=Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim().split('=').map(decodeURIComponent)).filter(v=>v.length===2));
  const [payload,signature]=String(cookies.hfs_session||'').split('.');
  if(!payload||!signature||!safeEqual(signature,sign(payload))) return false;
  try { return JSON.parse(Buffer.from(payload,'base64url').toString()).exp>Date.now(); } catch { return false; }
}

function stayDto(r) {
  return { checkInId:r.id, guestName:r.guest_name, mobileNo:r.mobile_no, gstin:r.gstin, address:r.address,
    state:r.state, bookingMode:r.booking_mode, adults:r.adults, children:r.children,
    totalGuest:num(r.adults)+num(r.children), roomNo:r.room_no, floor:r.floor, floorNo:r.floor,
    type:r.room_type, price:num(r.room_price), noOfDays:r.no_of_days, extraDays:r.extra_days,
    earlyCheckInCharges:num(r.early_charges), lateCheckoutCharges:num(r.late_charges),
    roomServiceCharges:num(r.room_service), laundryCharges:num(r.laundry), foodCharges:num(r.food),
    subTotal:num(r.subtotal), cgst:num(r.cgst), sgst:num(r.sgst), igst:num(r.igst), total:num(r.grand_total),
    advanceAmount:num(r.advance_amount), balanceAmount:num(r.balance_amount), checkInTime:fmt(r.check_in_time),
    plannedCheckOutTime:fmt(r.planned_checkout), actualCheckOutTime:fmt(r.actual_checkout), status:r.status,
    invoiceType:r.invoice_type, invoiceNo:r.invoice_no, gstInvoiceNo:r.invoice_type==='GST'?r.invoice_no:'',
    invoiceRowHidden:!!r.invoice_hidden, whatsAppSent:r.whatsapp_sent?'YES':'NO' };
}
function reservationDto(r) {
  return { bookingId:r.id, guestName:r.guest_name, mobile:r.mobile, gstin:r.gstin, address:r.address,
    state:r.state, invoiceType:r.invoice_type, bookingMode:r.booking_mode, roomNo:r.room_no,
    roomPrice:num(r.room_price), totalAmount:num(r.total_amount), advanceAmount:num(r.advance_amount),
    balanceAmount:num(r.balance_amount), expectedCheckIn:fmt(r.expected_check_in), expectedCheckOut:fmt(r.expected_check_out),
    notes:r.notes, status:r.status, checkInId:r.check_in_id };
}
function totals(form, room, advance, extraDays) {
  const days=Math.max(1,num(form.noOfDays)||1), extra=Math.max(0,num(extraDays));
  const price=num(form.manualPrice)||num(room.price), roomAmount=price*days, extraAmount=price*extra;
  const subtotal=roomAmount+extraAmount+num(form.earlyCheckInCharges)+num(form.lateCheckoutCharges)+num(form.roomServiceCharges)+num(form.laundryCharges)+num(form.foodCharges);
  const rate=String(form.invoiceType||'GST').toUpperCase()==='BILL'?0:(price<=7500?.05:.18);
  const gst=round(subtotal*rate), grand=round(subtotal+gst);
  return {days,extra,price,subtotal:round(subtotal),cgst:round(gst/2),sgst:round(gst/2),grand,balance:round(grand-num(advance))};
}

async function appData(sql) {
  const [settings,rooms,stays,reservations,payments]=await Promise.all([
    sql.query('SELECT * FROM hotel_settings WHERE id=1'), sql.query('SELECT * FROM rooms ORDER BY room_no'),
    sql.query('SELECT * FROM stays ORDER BY created_at DESC'), sql.query('SELECT * FROM reservations ORDER BY created_at DESC'),
    sql.query('SELECT * FROM payments ORDER BY created_at DESC')
  ]);
  const stayRows=stays.map(stayDto), active=stayRows.filter(s=>String(s.status).toUpperCase()==='CHECKED');
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const dateKey=v=>v?new Date(v).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}):'';
  const company=settings[0]||{};
  return { company:{name:company.name||'Hotel Fusion Suites',address:company.address||'',mobile:company.mobile||'',email:company.email||''},
    rooms:rooms.map(r=>({roomNo:r.room_no,floor:r.floor,type:r.type,price:num(r.price),status:r.status})), stays:stayRows,
    Reservations:reservations.map(reservationDto), payments:payments.map(p=>({dateTime:fmt(p.created_at),dateKey:dateKey(p.created_at),checkInId:p.check_in_id,
      guestName:p.guest_name,roomNo:p.room_no,paymentType:p.payment_type,paymentMode:p.payment_mode,amount:num(p.amount),note:p.note})),
    metrics:{totalRooms:rooms.length,availableRooms:rooms.filter(r=>r.status==='AVAILABLE').length,occupiedRooms:rooms.filter(r=>r.status==='CHECKED').length,
      todayCheckins:stays.filter(s=>dateKey(s.check_in_time)===today).length,expectedCheckouts:active.filter(s=>dateKey(s.plannedCheckOutTime)===today).length,
      activeRevenue:round(active.reduce((a,s)=>a+s.total,0)),todaysRevenue:round(payments.filter(p=>dateKey(p.created_at)===today).reduce((a,p)=>a+num(p.amount),0)),
      outstandingBalance:round(active.reduce((a,s)=>a+Math.max(0,s.balanceAmount),0)),monthGst:round(stayRows.reduce((a,s)=>a+s.cgst+s.sgst+s.igst,0))},
    bookingModes:['Walk In','Agoda','Booking.com','MakeMyTrip','Goibibo','Direct Call','Corporate','Other'], generatedAt:fmt(new Date()) };
}

async function execute(action,args,sql) {
  if(action==='getAppDataJson') return JSON.stringify(await appData(sql));
  if(action==='getReservations') return (await sql.query('SELECT * FROM reservations ORDER BY created_at DESC')).map(reservationDto);
  if(action==='saveCheckIn') {
    const f=args[0]||{}, room=(await sql.query('SELECT * FROM rooms WHERE room_no=$1',[clean(f.roomNo)]))[0];
    if(!room) throw new Error('Selected room not found.'); if(room.status!=='AVAILABLE') throw new Error(`Room ${f.roomNo} is not available.`);
    const sid=id('HFS/CI'), advance=num(f.advanceAmount), t=totals(f,room,advance,num(f.extraDays));
    const planned=new Date(Date.now()+t.days*86400000);
    await sql.query(`INSERT INTO stays(id,guest_name,mobile_no,gstin,address,state,booking_mode,adults,children,room_no,floor,room_type,room_price,no_of_days,extra_days,early_charges,late_charges,room_service,laundry,food,subtotal,cgst,sgst,grand_total,advance_amount,balance_amount,planned_checkout,status,invoice_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'CHECKED',$28)`,
      [sid,clean(f.guestName),clean(f.mobile),clean(f.gstin),clean(f.address),clean(f.state),clean(f.bookingMode)||'Walk In',num(f.adults)||1,num(f.children),room.room_no,room.floor,room.type,t.price,t.days,t.extra,num(f.earlyCheckInCharges),num(f.lateCheckoutCharges),num(f.roomServiceCharges),num(f.laundryCharges),num(f.foodCharges),t.subtotal,t.cgst,t.sgst,t.grand,advance,t.balance,planned,String(f.invoiceType||'GST').toUpperCase()]);
    await sql.query("UPDATE rooms SET status='CHECKED',updated_at=now() WHERE room_no=$1",[room.room_no]);
    if(advance>0) await sql.query(`INSERT INTO payments(reference_id,check_in_id,guest_name,room_no,payment_type,payment_mode,amount,note,invoice_type) VALUES($1,$1,$2,$3,'Check-in Advance',$4,$5,'Received during check-in',$6)`,[sid,clean(f.guestName),room.room_no,clean(f.paymentMode)||'Cash',advance,String(f.invoiceType||'GST').toUpperCase()]);
    const saved=(await sql.query('SELECT * FROM stays WHERE id=$1',[sid]))[0]; return {ok:true,checkInId:sid,stay:stayDto(saved),data:await appData(sql)};
  }
  if(action==='addPayment') {
    const p=args[0]||{}, amount=num(p.amount), stay=(await sql.query('SELECT * FROM stays WHERE id=$1',[clean(p.checkInId)]))[0];
    if(!stay) throw new Error('Check-in record not found.'); if(amount<=0) throw new Error('Enter a valid payment amount.');
    if(amount>num(stay.balance_amount)+.009) throw new Error(`Payment cannot exceed pending balance of INR ${num(stay.balance_amount).toFixed(2)}.`);
    await sql.query('UPDATE stays SET advance_amount=advance_amount+$1,balance_amount=balance_amount-$1,updated_at=now() WHERE id=$2',[amount,stay.id]);
    await sql.query(`INSERT INTO payments(reference_id,check_in_id,guest_name,room_no,payment_type,payment_mode,amount,note,invoice_type) VALUES($1,$1,$2,$3,'Payment Received',$4,$5,$6,$7)`,[stay.id,stay.guest_name,stay.room_no,clean(p.paymentMode)||'Cash',amount,clean(p.note),stay.invoice_type]);
    return {ok:true,data:await appData(sql)};
  }
  if(action==='vacateRoom') {
    const stay=(await sql.query('SELECT * FROM stays WHERE id=$1',[clean(args[0])]))[0]; if(!stay) throw new Error('Check-in record not found.');
    if(num(stay.balance_amount)>.009) throw new Error(`Checkout blocked. ${stay.guest_name} in room ${stay.room_no} has a pending balance of INR ${num(stay.balance_amount).toFixed(2)}. Please clear the balance before checkout.`);
    await sql.query("UPDATE stays SET status='VACATED BUT NOT CLEANED',actual_checkout=now(),updated_at=now() WHERE id=$1",[stay.id]);
    await sql.query("UPDATE rooms SET status='VACATED BUT NOT CLEANED',updated_at=now() WHERE room_no=$1",[stay.room_no]); return {ok:true,data:await appData(sql)};
  }
  if(action==='markRoomCleaned') {
    const stay=(await sql.query('SELECT * FROM stays WHERE id=$1',[clean(args[0])]))[0]; if(!stay) throw new Error('Check-in record not found.');
    await sql.query("UPDATE stays SET status='VACATED',updated_at=now() WHERE id=$1",[stay.id]); await sql.query("UPDATE rooms SET status='AVAILABLE',updated_at=now() WHERE room_no=$1",[stay.room_no]); return {ok:true,data:await appData(sql)};
  }
  if(action==='saveReservation') {
    const f=args[0]||{}, rid=clean(f.bookingId)||id('RES'), total=num(f.reservationPrice), advance=num(f.advanceAmount), existing=(await sql.query('SELECT id FROM reservations WHERE id=$1',[rid])).length;
    if(existing) await sql.query(`UPDATE reservations SET guest_name=$2,mobile=$3,gstin=$4,address=$5,state=$6,invoice_type=$7,booking_mode=$8,room_price=$9,total_amount=$9,advance_amount=$10,balance_amount=$11,expected_check_in=$12,expected_check_out=$13,notes=$14,updated_at=now() WHERE id=$1`,[rid,clean(f.guestName),clean(f.mobile),clean(f.gstin),clean(f.address),clean(f.state),String(f.invoiceType||'GST').toUpperCase(),clean(f.bookingMode),total,advance,round(total-advance),f.expectedCheckIn,f.expectedCheckOut,clean(f.notes)]);
    else await sql.query(`INSERT INTO reservations(id,guest_name,mobile,gstin,address,state,invoice_type,booking_mode,room_price,total_amount,advance_amount,balance_amount,expected_check_in,expected_check_out,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14)`,[rid,clean(f.guestName),clean(f.mobile),clean(f.gstin),clean(f.address),clean(f.state),String(f.invoiceType||'GST').toUpperCase(),clean(f.bookingMode),total,advance,round(total-advance),f.expectedCheckIn,f.expectedCheckOut,clean(f.notes)]);
    return {ok:true,bookingId:rid,data:await appData(sql)};
  }
  if(action==='convertReservation') {
    const rid=clean(args[0]), roomNo=clean(args[1]), r=(await sql.query('SELECT * FROM reservations WHERE id=$1',[rid]))[0]; if(!r) throw new Error('Reservation not found.');
    const result=await execute('saveCheckIn',[{guestName:r.guest_name,mobile:r.mobile,gstin:r.gstin,address:r.address||'-',state:r.state||'',bookingMode:r.booking_mode||'Reservation',roomNo,manualPrice:num(r.total_amount),noOfDays:1,advanceAmount:num(r.advance_amount),invoiceType:r.invoice_type,paymentMode:'Cash'}],sql);
    await sql.query("UPDATE reservations SET status='CHECKED-IN',room_no=$2,check_in_id=$3,updated_at=now() WHERE id=$1",[rid,roomNo,result.checkInId]); return {ok:true,checkInId:result.checkInId,data:await appData(sql)};
  }
  if(action==='cancelReservation'||action==='markReservationNoShow') { const status=action==='cancelReservation'?'CANCELLED':'NO SHOW'; await sql.query('UPDATE reservations SET status=$2,updated_at=now() WHERE id=$1',[clean(args[0]),status]); return {ok:true,data:await appData(sql)}; }
  if(action==='generateTaxInvoice') { const invoice=`HFS/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`; await sql.query('UPDATE stays SET invoice_no=$2,updated_at=now() WHERE id=$1',[clean(args[0]),invoice]); return {ok:true,invoiceNo:invoice,data:await appData(sql)}; }
  if(action==='hideGeneratedInvoiceRow') { await sql.query('UPDATE stays SET invoice_hidden=true WHERE id=$1',[clean(args[0])]); return {ok:true,data:await appData(sql)}; }
  if(action==='markInvoiceWhatsAppSent') { await sql.query('UPDATE stays SET whatsapp_sent=true WHERE id=$1',[clean(args[0])]); return {ok:true}; }
  if(action==='updateCheckIn') {
    const f=args[0]||{}, stay=(await sql.query('SELECT * FROM stays WHERE id=$1',[clean(f.checkInId)]))[0];
    if(!stay) throw new Error('Check-in record not found.');
    const roomNo=clean(f.roomNo)||stay.room_no, room=(await sql.query('SELECT * FROM rooms WHERE room_no=$1',[roomNo]))[0];
    if(!room) throw new Error('Room not found.');
    if(roomNo!==stay.room_no && room.status!=='AVAILABLE') throw new Error(`Room ${roomNo} is not available.`);
    const advance=num(f.advanceAmount), t=totals(f,room,advance,num(f.extraDays));
    await sql.query(`UPDATE stays SET guest_name=$2,mobile_no=$3,gstin=$4,address=$5,state=$6,booking_mode=$7,adults=$8,children=$9,room_no=$10,floor=$11,room_type=$12,room_price=$13,no_of_days=$14,extra_days=$15,early_charges=$16,late_charges=$17,room_service=$18,laundry=$19,food=$20,subtotal=$21,cgst=$22,sgst=$23,grand_total=$24,advance_amount=$25,balance_amount=$26,invoice_type=$27,updated_at=now() WHERE id=$1`,
      [stay.id,clean(f.guestName)||stay.guest_name,clean(f.mobile)||stay.mobile_no,clean(f.gstin),clean(f.address),clean(f.state),clean(f.bookingMode),num(f.adults)||1,num(f.children),roomNo,room.floor,room.type,t.price,t.days,t.extra,num(f.earlyCheckInCharges),num(f.lateCheckoutCharges),num(f.roomServiceCharges),num(f.laundryCharges),num(f.foodCharges),t.subtotal,t.cgst,t.sgst,t.grand,advance,t.balance,String(f.invoiceType||stay.invoice_type).toUpperCase()]);
    if(roomNo!==stay.room_no) { await sql.query("UPDATE rooms SET status='AVAILABLE',updated_at=now() WHERE room_no=$1",[stay.room_no]); await sql.query("UPDATE rooms SET status='CHECKED',updated_at=now() WHERE room_no=$1",[roomNo]); }
    return {ok:true,data:await appData(sql)};
  }
  throw new Error(`Unsupported action: ${action}`);
}

module.exports = async function handler(req,res) {
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method not allowed.'});
  try {
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}), action=clean(body.action), args=Array.isArray(body.args)?body.args:[];
    if(action==='login') {
      if(!process.env.ADMIN_PASSWORD || !process.env.AUTH_SECRET) throw new Error('Server login is not configured.');
      const credentials=args[0]||{}, expectedUser=process.env.ADMIN_USER||'ADMIN';
      if(!safeEqual(String(credentials.user||'').toUpperCase(),expectedUser.toUpperCase()) || !safeEqual(credentials.password||'',process.env.ADMIN_PASSWORD)) return res.status(401).json({ok:false,error:'Invalid user ID or password.'});
      res.setHeader('Set-Cookie',`hfs_session=${makeSession()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
      return res.status(200).json({ok:true,result:{ok:true}});
    }
    if(action==='logout') {
      res.setHeader('Set-Cookie','hfs_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
      return res.status(200).json({ok:true,result:{ok:true}});
    }
    if(!isAuthenticated(req)) return res.status(401).json({ok:false,error:'Please sign in again.'});
    const result=await execute(action,args,db()); return res.status(200).json({ok:true,result});
  }
  catch(error) { console.error(error); return res.status(400).json({ok:false,error:error.message||String(error)}); }
};
