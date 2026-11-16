import sharp from 'sharp';
import fs from 'fs';
const O = '/Users/admin/Downloads/orig/', A = process.argv[2] + '/assets/', L = process.argv[2] + '/layers/';
// 1. Dashboard: blur personal data (greeting name, account name+email, personal referral URL), then crop to the card area
const dashRegions = [ [870, 333, 252, 82], [425, 920, 230, 85], [1175, 662, 318, 78] ];
let dash = sharp(O + 'affiliate_runner_network_dashboard.png').removeAlpha();
const comps = [];
for (const [x, y, w, h] of dashRegions) {
  const blurred = await sharp(O + 'affiliate_runner_network_dashboard.png').removeAlpha().extract({ left: x, top: y, width: w, height: h }).blur(16).modulate({ brightness: 1.0 }).png().toBuffer();
  // feathered mask so the blur has soft edges
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><defs><filter id="f"><feGaussianBlur stdDeviation="6"/></filter></defs><rect x="8" y="8" width="${w-16}" height="${h-16}" rx="10" fill="#fff" filter="url(#f)"/></svg>`);
  const soft = await sharp(blurred).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  comps.push({ input: soft, left: x, top: y });
}
const masked = await dash.composite(comps).png().toBuffer();
await sharp(masked).toFile(A + 'dashboard_masked_full.png');
await sharp(masked).extract({ left: 250, top: 255, width: 1440, height: 810 }).png().toFile(A + 'dashboard_card.png');
// 2. Track Order UI: full frame (no personal data)
await sharp(O + 'track_order_ui.png').removeAlpha().png().toFile(A + 'track_order_card.png');
// 3. WhatsApp: crop around phone + hand, text untouched
await sharp(O + 'whatsapp_phone_mockup.webp').extract({ left: 930, top: 120, width: 1140, height: 1880 }).png().toFile(A + 'whatsapp_card.png');
// 4. Logos: trim padding only (no resize / recolour)
for (const f of ['ecocash.png','innbucks.png','mastercard.webp','omari.webp','onemoney.png','smile_and_pay.png','visa.png','zimswitch.png']) {
  const out = A + f.replace(/\.(png|webp)$/, '') + '_trim.png';
  const m = await sharp(O + f).metadata();
  let img = sharp(O + f).ensureAlpha();
  await img.trim({ threshold: 12 }).png().toFile(out);
  const t = await sharp(out).metadata();
  console.log(f, m.width + 'x' + m.height, '->', t.width + 'x' + t.height);
}
if (!fs.existsSync(A + 'vanguard_logo.jpg')) fs.copyFileSync(O + 'vanguard_logo.jpg', A + 'vanguard_logo.jpg');
// 5. Rounded alpha on captured page layers (captured at 2x)
const round = async (file, r) => { const p = L + file; const m = await sharp(p).metadata();
  const svg = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect width="${m.width}" height="${m.height}" rx="${r}" fill="#fff"/></svg>`);
  const b = await sharp(p).ensureAlpha().composite([{ input: svg, blend: 'dest-in' }]).png().toBuffer(); fs.writeFileSync(p, b); };
await round('start_shopping_btn.png', 16);
for (let i = 0; i < 5; i++) await round(`card_${i}.png`, 24);
for (let i = 0; i < 3; i++) await round(`trust_${i}.png`, 32);
