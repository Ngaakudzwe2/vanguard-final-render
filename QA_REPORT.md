# Vanguard Digital — Final Render QA Report (Prompt 2, v2)

Rendered 16 Nov 2026 from a live capture of https://vanguarddigital.co.zw/ taken the same day.

## Output

| Item | Result |
|---|---|
| MP4 | `vanguard_digital_15s_1440x1152_60fps.mp4` |
| Codec | H.264, High profile, yuv420p, BT.709 (GPU encode: `h264_videotoolbox`) |
| Frame rate | 60/1 fps, constant (r_frame_rate = avg_frame_rate = 60/1) |
| Frames | 900 |
| Duration | 15.000000 s (ffprobe, stream and container) |
| Resolution | 1440 × 1152 |
| File size | 15,151,854 bytes (14.4 MiB), about 8.1 Mb/s |

Pipeline: `cutlist.json` → deterministic WebGL2/Three.js `seek(t)` (no timers or CSS transitions). This was rendered on the GPU (AMD Radeon Pro 555 via ANGLE) in 4 parallel chunks of 225 frames, written as lossless FFV1, stitched with ffmpeg, and encoded once to H.264.

## Checks

1. **Specs: PASS.** ffprobe shows h264 High, 1440×1152, 60/1 constant frame rate, 900 frames and 15.000000 s.
2. **Marks undistorted: PASS.**
   - Official Vanguard logo: from `vanguard_logo.jpg`, replacing the scraped header logo and used in the CTA badge pill. Square aspect is kept, with no recolour.
   - Smile & Pay and all seven payment logos (EcoCash, InnBucks, Omari, ZimSwitch, Visa, Mastercard, OneMoney): only the transparent padding was trimmed. Each logo is drawn at uniform scale on a plain white chip.
   - Store marks are the captured live tiles.
   - Every texture has mipmaps and anisotropic filtering. Floating marks turn toward the lens as they rise, so they face the camera instead of being keystoned.
   - Encoded frames match the lossless stills at 39–44 dB PSNR.
3. **Tech Sourcing and HomeHaul: PASS.** The status shown matches the live homepage:
   - Tech sourcing: live (links to `/shop/tech-sourcing`). Its tile shows Apple, Samsung, Pixel, Dell and HP marks, so the independence note "Independent; not affiliated." is shown.
   - HomeHaul: not a live store. The live page says "HomeHaul - Coming soon. Open waitlist.", so the chip reads "Coming soon · Waitlist" and stays visible with its caption.
   - The homepage tiles carry no visible tagline, so the approved purpose lines from the brief are used unchanged, as small captions on each tile.
4. **Tracking: PASS.** The Track Order UI and WhatsApp mockup pixels are untouched (WhatsApp is cropped around the phone only). Both rise as floating layers in the same shot, with no cut to an app screen.
5. **Affiliate / Runner Network: PASS.** The dashboard appears only as a floating depth layer, lifted 35 px, held, then settled. There is no onboarding, walkthrough or tab clicking, and no stats beyond the zero-state values already in the screenshot. The greeting name, the account name and email, and the personal referral URL are blurred.
6. **CTA readable: PASS.** The final frame shows "Shop smarter. Live ahead.", "See your full Zimbabwe landed price before you pay.", the real "Start shopping" button and "vanguarddigital.co.zw". It holds from about 14.6 s to 15.0 s.
7. **Nothing invented: PASS.**
   - Every overlay string is checked at runtime against the cut list's `allowed_text`, and the build fails if one isn't listed.
   - Product names and prices are the live card pixels.
   - There are no new stores or payment brands, and no "SmartPay".
8. **File opens and plays: PASS.** A full ffmpeg decode with `-xerror` finished with no errors.

Continuity: ffmpeg `scdet` across all 900 frames gives a highest scene-change score of 0.42 (the cut threshold is 10), so the video is one continuous shot. The camera target's x position stays fixed, so there is no sideways swing, and the field of view is constant, so there is no fake zoom.

## Where the live page differs from the brief (live page wins)

- **No affiliate or Runner Network section, and no affiliate pill, on the homepage.** No pill was invented. The only pill shown is "Partner affiliate · 60% of service fee", which is already inside the supplied dashboard asset. The dashboard floats beside the trust strip.
- **Store row is a 36 s scrolling marquee** that shows about 5 tiles at a time. Its real speed is kept, and its starting position is set so Tech sourcing and HomeHaul are both in view during their beat. In "Choose platforms", only the live tiles inside the marquee at that moment lift, in the brief's order: Amazon, Apple, Samsung.
- **`logo_tiles_x4` (intro lift) is not on the live page.** It's flagged in the cut list, and no substitute was added.
- **No "How it works" section on the homepage.**
- **The hero is a 7-slide carousel.** It's pinned to slide 1, which shows the phone, trolley and Amazon imagery, so all plates stay consistent.
- **The landed-price line is part of the hero paragraph**, so the focus pull lands on that real text rather than an overlay.
- **Trending Now cards:** the five cards visible on the live page are used: iPhone 18 Pro Max, MacBook Pro, the TQPONLY car part, the USB-SATA adapter and the Scosche install kit.

## Needs owner confirmation

- **WhatsApp mockup:** the order number VG-257334 is left as supplied. The brief allows this if the owner approves. All other identifying details in that asset were already blurred.
- **Preview stills:** this run captured, authored and rendered from scratch, so the stills in `preview_stills/` are the ones the final MP4 was rendered from. Please review them alongside the video.

## Contents

- `vanguard_digital_15s_1440x1152_60fps.mp4`: final render
- `preview_stills/`: the 8 cut-list stills (0.0, 3.5, 7.0, 9.2, 10.5, 12.0, 13.5, 15.0 s)
- `source_assets/`: the supplied assets. The dashboard is included only as `affiliate_runner_network_dashboard_MASKED.png`; the unmasked original isn't shipped.
- `render_source/`: `cutlist.json`, `layers.json`, `scene.js` and `index.html` (the seek(t) scene), plus `render.mjs`, `capture2.mjs` and `prep.mjs`
