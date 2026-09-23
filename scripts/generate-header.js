import fs from 'fs';
import sharp from 'sharp';

// Build a crisp 1200x320 SVG mirroring the user's uploaded binder notebook header
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" width="1200" height="320">
  <defs>
    <!-- Binder spine gradient -->
    <linearGradient id="spineGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4a4d52"/>
      <stop offset="25%" stop-color="#7a7e85"/>
      <stop offset="50%" stop-color="#3c3e42"/>
      <stop offset="80%" stop-color="#242629"/>
      <stop offset="100%" stop-color="#18191b"/>
    </linearGradient>

    <!-- Metal ring chrome gradient -->
    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8a8d92"/>
      <stop offset="20%" stop-color="#d8dbdf"/>
      <stop offset="45%" stop-color="#f5f7fa"/>
      <stop offset="60%" stop-color="#ffffff"/>
      <stop offset="80%" stop-color="#9ea2a8"/>
      <stop offset="100%" stop-color="#4d5055"/>
    </linearGradient>

    <!-- Hole inner shadow -->
    <radialGradient id="holeShadow" cx="50%" cy="40%" r="50%">
      <stop offset="60%" stop-color="#1a1c1e"/>
      <stop offset="85%" stop-color="#2c3035"/>
      <stop offset="100%" stop-color="#484d54"/>
    </radialGradient>

    <!-- Hole outer shadow on paper -->
    <radialGradient id="holePaperShadow" cx="50%" cy="50%" r="60%">
      <stop offset="70%" stop-color="rgba(0,0,0,0.3)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>

    <!-- Ring shadow on paper -->
    <filter id="ringDropShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="3" dy="6" stdDeviation="4" flood-color="rgba(0,0,0,0.35)"/>
    </filter>

    <!-- Sticker drop shadow -->
    <filter id="stickerShadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="2" dy="4" stdDeviation="3" flood-color="rgba(0,0,0,0.18)"/>
    </filter>

    <!-- Soft paper bottom fade to #f7f7ef -->
    <linearGradient id="paperBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="15%" stop-color="#fdfcf8"/>
      <stop offset="50%" stop-color="#faf9f4"/>
      <stop offset="100%" stop-color="#f7f7ef"/>
    </linearGradient>
  </defs>

  <!-- 1. Paper Background connecting to #f7f7ef -->
  <rect x="0" y="45" width="1200" height="275" fill="url(#paperBg)"/>

  <!-- Subtle paper texture dots/fibers -->
  <rect x="0" y="315" width="1200" height="5" fill="#f7f7ef"/>

  <!-- 2. Top Binder Spine / Mechanism -->
  <rect x="0" y="0" width="1200" height="48" fill="url(#spineGrad)"/>
  <!-- Spine metallic highlight bars -->
  <line x1="0" y1="12" x2="1200" y2="12" stroke="#9ea3aa" stroke-width="1.5" opacity="0.6"/>
  <line x1="0" y1="28" x2="1200" y2="28" stroke="#1f2022" stroke-width="2"/>
  <line x1="0" y1="46" x2="1200" y2="46" stroke="#121315" stroke-width="2.5"/>

  <!-- Spine metal bolts / screw rivets -->
  <g fill="#888c94" stroke="#25272a" stroke-width="1.5">
    <circle cx="45" cy="24" r="7"/>
    <circle cx="45" cy="24" r="3" fill="#333"/>
    <circle cx="340" cy="24" r="6"/>
    <circle cx="340" cy="24" r="2.5" fill="#333"/>
    <circle cx="600" cy="24" r="7"/>
    <circle cx="600" cy="24" r="3" fill="#333"/>
    <circle cx="860" cy="24" r="6"/>
    <circle cx="860" cy="24" r="2.5" fill="#333"/>
    <circle cx="1155" cy="24" r="7"/>
    <circle cx="1155" cy="24" r="3" fill="#333"/>
  </g>

  <!-- 3. Punched Holes & Chrome Metal Binder Rings (6 rings) -->
  <!-- Ring positions: 110, 270, 430, 710, 890, 1070 (matching standard 6-hole planner) -->
  <g id="binderRings">
    <!-- Hole 1 -->
    <circle cx="110" cy="88" r="19" fill="url(#holeShadow)" filter="url(#stickerShadow)"/>
    <circle cx="110" cy="88" r="16" fill="#1b1d20"/>
    <path d="M 103,0 L 103,80 A 7,8 0 0,0 117,80 L 117,0 Z" fill="url(#ringGrad)" filter="url(#ringDropShadow)"/>
    <ellipse cx="110" cy="82" rx="7" ry="5" fill="#585c63"/>

    <!-- Hole 2 -->
    <circle cx="270" cy="88" r="19" fill="url(#holeShadow)" filter="url(#stickerShadow)"/>
    <circle cx="270" cy="88" r="16" fill="#1b1d20"/>
    <path d="M 263,0 L 263,80 A 7,8 0 0,0 277,80 L 277,0 Z" fill="url(#ringGrad)" filter="url(#ringDropShadow)"/>
    <ellipse cx="270" cy="82" rx="7" ry="5" fill="#585c63"/>

    <!-- Hole 3 -->
    <circle cx="430" cy="88" r="19" fill="url(#holeShadow)" filter="url(#stickerShadow)"/>
    <circle cx="430" cy="88" r="16" fill="#1b1d20"/>
    <path d="M 423,0 L 423,80 A 7,8 0 0,0 437,80 L 437,0 Z" fill="url(#ringGrad)" filter="url(#ringDropShadow)"/>
    <ellipse cx="430" cy="82" rx="7" ry="5" fill="#585c63"/>

    <!-- Hole 4 -->
    <circle cx="710" cy="88" r="19" fill="url(#holeShadow)" filter="url(#stickerShadow)"/>
    <circle cx="710" cy="88" r="16" fill="#1b1d20"/>
    <path d="M 703,0 L 703,80 A 7,8 0 0,0 717,80 L 717,0 Z" fill="url(#ringGrad)" filter="url(#ringDropShadow)"/>
    <ellipse cx="710" cy="82" rx="7" ry="5" fill="#585c63"/>

    <!-- Hole 5 -->
    <circle cx="890" cy="88" r="19" fill="url(#holeShadow)" filter="url(#stickerShadow)"/>
    <circle cx="890" cy="88" r="16" fill="#1b1d20"/>
    <path d="M 883,0 L 883,80 A 7,8 0 0,0 897,80 L 897,0 Z" fill="url(#ringGrad)" filter="url(#ringDropShadow)"/>
    <ellipse cx="890" cy="82" rx="7" ry="5" fill="#585c63"/>

    <!-- Hole 6 -->
    <circle cx="1070" cy="88" r="19" fill="url(#holeShadow)" filter="url(#stickerShadow)"/>
    <circle cx="1070" cy="88" r="16" fill="#1b1d20"/>
    <path d="M 1063,0 L 1063,80 A 7,8 0 0,0 1077,80 L 1077,0 Z" fill="url(#ringGrad)" filter="url(#ringDropShadow)"/>
    <ellipse cx="1070" cy="82" rx="7" ry="5" fill="#585c63"/>
  </g>

  <!-- 4. Left Retro Stickers -->
  <g id="stickers">
    <!-- Red Stamp Sticker "SAY CHEESE!" -->
    <g transform="translate(138, 170) rotate(-11)" filter="url(#stickerShadow)">
      <!-- Octagonal / notched badge -->
      <polygon points="12,0 208,0 220,12 220,58 208,70 12,70 0,58 0,12" fill="#ef4452"/>
      <!-- Inner dashed white border -->
      <polygon points="14,4 206,4 216,14 216,56 206,66 14,66 4,56 4,14" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-dasharray="6,4"/>
      <text x="110" y="47" font-family="'Impact', 'Arial Black', sans-serif" font-weight="900" font-size="28" fill="#ffffff" text-anchor="middle" letter-spacing="2">SAY CHEESE!</text>
    </g>

    <!-- Purple Triangular Sticker "看一眼 记一次 / 微笑打卡" -->
    <g transform="translate(145, 275) rotate(-18)" filter="url(#stickerShadow)">
      <!-- Triangle with rounded corners -->
      <path d="M 10,-85 L 180,-10 C 190,-5 190,10 180,15 L 20,95 C 10,100 -5,95 -8,85 L -75,-65 C -80,-75 -70,-90 -55,-90 Z" fill="#6d58ee"/>
      <!-- Inner white chevron / frame line -->
      <path d="M 10,-72 L 165,-5 L 20,80 L -55,-65 Z" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      
      <!-- Upper line with star -->
      <g fill="#ffffff" font-family="'Noto Sans SC', 'PingFang SC', sans-serif" font-weight="900" font-size="16">
        <text x="2" y="-30" text-anchor="middle">看 一 眼</text>
        <!-- Center star -->
        <polygon points="45,-37 48,-28 57,-28 50,-22 53,-13 45,-18 37,-13 40,-22 33,-28 42,-28" fill="#ffffff"/>
        <text x="85" y="-12" text-anchor="middle">记 一 次</text>
      </g>
      
      <!-- Lower line: 微笑打卡 -->
      <g fill="#ffffff" font-family="'Noto Sans SC', 'PingFang SC', sans-serif" font-weight="900" font-size="19">
        <path d="M -15,22 L 5,30" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
        <text x="50" y="38" text-anchor="middle">微 笑 打 卡</text>
        <path d="M 98,46 L 118,38" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
      </g>
    </g>

    <!-- Green Camera Badge -->
    <g transform="translate(325, 175) rotate(6)" filter="url(#stickerShadow)">
      <!-- Outer white and green circle -->
      <circle cx="0" cy="0" r="54" fill="#ffffff" stroke="#22c55e" stroke-width="7"/>
      <!-- Flash rays -->
      <g stroke="#22c55e" stroke-width="4.5" stroke-linecap="round">
        <line x1="20" y1="-38" x2="28" y2="-48"/>
        <line x1="34" y1="-28" x2="48" y2="-34"/>
        <line x1="38" y1="-14" x2="52" y2="-16"/>
      </g>
      <!-- Cute camera body -->
      <rect x="-30" y="-18" width="60" height="42" rx="9" fill="none" stroke="#22c55e" stroke-width="5.5"/>
      <!-- Viewfinder bump -->
      <path d="M -15,-18 L -9,-27 L 9,-27 L 15,-18 Z" fill="none" stroke="#22c55e" stroke-width="5" stroke-linejoin="round"/>
      <!-- Lens -->
      <circle cx="0" cy="3" r="14" fill="none" stroke="#22c55e" stroke-width="5.5"/>
      <circle cx="0" cy="3" r="5" fill="#22c55e"/>
      <circle cx="-19" cy="-8" r="3" fill="#22c55e"/>
    </g>
  </g>

  <!-- 5. Main Title Calligraphy "今日露脸签到册" (Brush calligraphy curves & glyphs) -->
  <g id="chineseCalligraphy" fill="#1b1a18" transform="translate(425, 125)">
    <!-- Custom expressive handwritten brush path for: 今日露脸签到册 -->
    
    <!-- "今" (x: 0..95) -->
    <g transform="translate(0, 0)">
      <!-- Left sweeping stroke (撇) -->
      <path d="M 68,12 C 60,25 45,55 18,92 C 14,97 8,95 10,88 C 28,52 48,22 62,6 C 65,3 70,6 68,12 Z"/>
      <!-- Right dot/falling stroke (捺) -->
      <path d="M 60,32 C 72,42 92,68 108,82 C 112,85 108,90 102,88 C 88,74 72,50 56,36 C 53,33 56,30 60,32 Z"/>
      <!-- Horizontal stroke & hook (横折钩) -->
      <path d="M 38,72 C 55,68 76,64 88,62 C 94,61 97,64 94,72 C 90,82 82,108 72,132 C 68,140 60,136 62,128 C 70,105 78,84 80,74 C 70,75 52,78 35,82 C 30,83 32,74 38,72 Z"/>
    </g>

    <!-- "日" (x: 105..185) -->
    <g transform="translate(108, 12)">
      <!-- Left vertical stroke -->
      <path d="M 22,25 C 24,55 22,95 18,125 C 16,131 24,133 27,126 C 32,95 33,52 30,22 C 29,16 21,18 22,25 Z"/>
      <!-- Top-right hook -->
      <path d="M 25,25 C 45,20 72,16 85,15 C 92,14 96,18 94,28 C 90,60 88,98 84,128 C 82,135 74,130 76,122 C 79,98 81,60 82,28 C 70,29 48,32 28,36 Z"/>
      <!-- Middle horizontal -->
      <path d="M 26,70 C 45,67 62,64 78,63 C 83,63 83,71 78,71 C 60,72 44,75 25,78 C 21,78 21,70 26,70 Z"/>
      <!-- Bottom closing -->
      <path d="M 22,118 C 42,115 62,112 80,111 C 86,111 86,120 78,120 C 58,122 38,125 18,128 C 14,128 15,119 22,118 Z"/>
    </g>

    <!-- "露" (x: 205..300) -->
    <g transform="translate(205, -5)">
      <!-- Rain radical top bar -->
      <path d="M 25,28 C 52,24 82,20 102,19 C 108,19 108,27 101,28 C 80,30 52,33 22,36 C 16,36 18,29 25,28 Z"/>
      <!-- Rain left, center vertical, hook -->
      <path d="M 28,34 C 27,55 24,72 20,85 C 38,82 78,75 96,73 C 102,72 105,76 102,83 C 98,92 90,105 85,108 C 80,111 76,105 78,98 C 82,88 88,81 88,78 C 72,80 38,87 23,89 C 18,90 18,80 20,72 C 22,58 24,45 25,34 Z"/>
      <path d="M 58,26 C 60,42 60,65 59,82 C 58,88 52,88 52,82 C 53,65 53,42 52,26 Z"/>
      <!-- Rain 4 water dots -->
      <circle cx="38" cy="54" r="4.5"/>
      <circle cx="42" cy="70" r="4.5"/>
      <circle cx="75" cy="50" r="4.5"/>
      <circle cx="78" cy="66" r="4.5"/>
      <!-- Lower part: 疋 / 各 -->
      <path d="M 40,95 C 60,92 78,90 92,89 C 97,89 96,96 90,98 C 75,102 55,105 38,108 C 32,108 34,97 40,95 Z"/>
      <path d="M 30,118 C 50,112 72,110 88,114 C 95,116 88,124 80,128 C 65,135 48,142 32,148 C 26,150 24,142 29,138 C 45,128 62,122 75,118 C 60,118 42,122 28,126 Z"/>
      <path d="M 52,108 C 62,120 78,138 98,150 C 104,154 98,160 92,156 C 75,142 58,126 48,112 Z"/>
    </g>

    <!-- "脸" (x: 320..420) -->
    <g transform="translate(320, 5)">
      <!-- Moon radical on left (月) -->
      <path d="M 28,25 C 26,60 22,105 12,138 C 9,144 17,144 20,138 C 28,108 32,65 34,25 C 35,18 27,18 28,25 Z"/>
      <path d="M 32,25 C 44,22 55,20 62,19 C 68,18 69,24 67,32 C 63,65 60,105 58,132 C 57,140 50,136 51,128 C 53,105 56,65 58,28 C 52,29 42,31 32,34 Z"/>
      <path d="M 32,60 C 42,58 52,56 60,55 C 65,55 65,63 59,64 C 50,65 40,67 31,69 Z"/>
      <path d="M 28,95 C 38,93 48,91 58,90 C 64,90 64,98 57,99 C 48,100 37,102 27,104 Z"/>

      <!-- Right part: 佥 (人 + 一 + 䒑 + 口) -->
      <!-- Top roof (人) -->
      <path d="M 105,18 C 96,35 82,58 68,72 C 64,76 60,70 64,65 C 78,48 92,28 100,12 C 103,8 108,12 105,18 Z"/>
      <path d="M 102,28 C 112,38 128,58 138,70 C 142,75 136,78 130,74 C 120,62 108,45 98,34 Z"/>
      <!-- Horizontal bar -->
      <path d="M 80,68 C 95,65 115,62 128,60 C 134,59 135,66 128,68 C 115,70 95,73 78,76 Z"/>
      <!-- Lower strokes & 口 -->
      <path d="M 78,88 C 88,85 118,80 128,78 C 133,77 135,84 130,86 C 118,88 92,93 75,97 Z"/>
      <path d="M 82,102 C 84,118 83,132 80,145 C 95,142 118,138 128,135 C 134,134 134,142 126,144 C 110,147 92,150 75,152 C 70,153 72,142 74,132 C 76,118 77,105 78,98 Z"/>
    </g>

    <!-- "签" (x: 460..560) -->
    <g transform="translate(460, -5)">
      <!-- Bamboo radical (竹) -->
      <path d="M 32,24 C 28,35 22,46 15,54 C 12,57 9,52 12,48 C 18,40 24,30 28,20 Z"/>
      <path d="M 28,32 C 40,29 55,26 64,25 C 70,24 68,32 62,34 C 52,36 40,38 27,41 Z"/>
      <path d="M 45,35 C 44,48 42,60 38,72 C 36,76 31,74 33,68 C 36,58 37,47 38,36 Z"/>

      <path d="M 82,18 C 78,28 72,38 65,45 C 62,48 59,44 62,40 C 68,32 74,24 78,15 Z"/>
      <path d="M 78,25 C 92,22 108,18 118,17 C 124,16 123,24 116,26 C 104,28 90,31 77,34 Z"/>
      <path d="M 98,28 C 98,42 96,56 94,68 C 93,73 87,72 88,66 C 90,55 91,42 92,30 Z"/>

      <!-- Lower part: 佥 (人 + 一 + 日) -->
      <path d="M 68,58 C 55,75 38,98 18,115 C 14,118 10,114 14,108 C 30,90 48,68 62,52 Z"/>
      <path d="M 65,68 C 78,80 102,105 118,120 C 124,125 118,130 112,124 C 98,110 78,88 62,72 Z"/>
      <path d="M 42,98 C 58,95 82,90 98,88 C 104,87 104,95 98,96 C 80,99 58,103 40,106 Z"/>
      <!-- Lower box / 日 -->
      <path d="M 45,115 C 46,132 44,148 40,160 C 58,156 82,150 96,146 C 102,145 101,153 94,155 C 78,159 55,164 36,168 C 32,168 35,158 37,146 C 39,132 40,120 40,112 Z"/>
      <path d="M 42,115 C 60,111 82,106 94,105 C 100,104 102,110 99,118 C 96,132 94,145 92,155 C 91,160 85,156 86,150 C 88,140 90,128 92,115 C 80,117 60,121 42,125 Z"/>
    </g>

    <!-- "到" (x: 585..680) -->
    <g transform="translate(585, 12)">
      <!-- Left part: 至 (一 + 厶 + 土) -->
      <path d="M 18,22 C 38,19 62,16 78,15 C 84,15 84,23 78,24 C 60,26 38,28 16,31 Z"/>
      <path d="M 48,24 C 42,42 32,60 20,72 C 16,76 18,80 25,78 C 38,72 58,65 68,62 C 74,60 74,68 68,70 C 52,76 32,84 22,88 C 14,92 10,84 16,76 C 28,62 38,44 42,28 Z"/>
      <path d="M 48,68 C 55,75 68,90 74,98 C 78,103 72,108 66,104 C 60,96 50,84 44,76 Z"/>
      <!-- Lower 土 -->
      <path d="M 22,102 C 38,100 55,97 68,96 C 74,95 74,103 68,104 C 52,106 36,108 18,111 Z"/>
      <path d="M 45,88 C 46,104 46,120 44,136 C 43,142 36,142 37,135 C 38,120 38,104 38,88 Z"/>
      <path d="M 12,138 C 34,134 58,130 80,126 C 88,124 90,134 78,136 C 55,140 30,145 10,148 Z"/>

      <!-- Right part: 刂 (立刀旁) -->
      <!-- Short left vertical -->
      <path d="M 98,42 C 100,60 98,78 95,95 C 93,101 87,99 88,92 C 90,78 91,62 90,45 C 89,38 97,36 98,42 Z"/>
      <!-- Long right vertical with sharp upward hook (竖钩) -->
      <path d="M 128,15 C 130,48 128,95 125,135 C 123,162 108,168 95,160 C 90,156 94,148 100,150 C 110,155 115,148 116,132 C 119,95 120,48 118,15 C 117,8 127,8 128,15 Z"/>
    </g>

    <!-- "册" (x: 720..815) -->
    <g transform="translate(720, 10)">
      <!-- Left vertical stave with hook -->
      <path d="M 22,25 C 24,58 22,105 18,138 C 16,146 8,142 10,135 C 14,105 16,60 15,28 C 15,18 22,18 22,25 Z"/>
      <!-- Center vertical stave 1 -->
      <path d="M 45,32 C 46,62 45,95 42,128 C 41,135 34,134 35,126 C 38,96 38,62 37,32 C 37,25 44,25 45,32 Z"/>
      <!-- Center vertical stave 2 -->
      <path d="M 68,30 C 69,60 68,95 65,128 C 64,135 57,134 58,126 C 61,96 61,60 60,30 C 60,24 67,24 68,30 Z"/>
      <!-- Right vertical stave with bottom curve -->
      <path d="M 92,22 C 94,55 93,98 90,135 C 88,152 75,155 65,148 C 60,144 65,138 70,140 C 78,144 82,138 83,126 C 85,96 85,55 84,22 C 84,15 91,15 92,22 Z"/>
      <!-- Crossbars (横划贯穿) -->
      <!-- Upper crossbar -->
      <path d="M 12,58 C 38,53 68,48 98,45 C 104,44 105,52 98,54 C 68,57 38,62 10,67 C 5,68 6,59 12,58 Z"/>
      <!-- Lower crossbar -->
      <path d="M 14,102 C 40,97 70,92 100,89 C 106,88 107,96 100,98 C 70,101 40,106 12,111 C 7,112 8,103 14,102 Z"/>
    </g>
  </g>

  <!-- 6. Right Side Smiley Face & "SMILE & CHECK IN" -->
  <g id="rightDetails" transform="translate(1120, 160)">
    <!-- Cute rotated smiley face -->
    <g transform="translate(20, -10) rotate(12)">
      <circle cx="-10" cy="-6" r="3.5" fill="#1b1a18"/>
      <circle cx="8" cy="-6" r="3.5" fill="#1b1a18"/>
      <path d="M -12,4 C -4,14 6,14 12,4" fill="none" stroke="#1b1a18" stroke-width="3.5" stroke-linecap="round"/>
    </g>

    <!-- Coral orange modern typography -->
    <g fill="#ea580c" font-family="'Inter', 'Arial', sans-serif" font-weight="700" letter-spacing="3" text-anchor="middle" transform="translate(0, 75)">
      <text x="0" y="0" font-size="14">S M I L E   &amp;</text>
      <text x="0" y="20" font-size="14">C H E C K   I N</text>
    </g>
  </g>
</svg>`;

// Write the SVG file
fs.writeFileSync('public/maolasong-notebook-header.svg', svg);
console.log('Saved public/maolasong-notebook-header.svg');

// Render to high-res PNG for maolasong-notebook-header-OYYDUDEX-1.png and notebook-header.png
sharp(Buffer.from(svg))
  .png({ quality: 100 })
  .toFile('public/maolasong-notebook-header-OYYDUDEX-1.png')
  .then(() => {
    console.log('Saved public/maolasong-notebook-header-OYYDUDEX-1.png');
    // Also save copy as notebook-header.png
    return sharp(Buffer.from(svg)).png().toFile('public/notebook-header.png');
  })
  .then(() => {
    console.log('Saved public/notebook-header.png');
  })
  .catch(err => {
    console.error('Error rendering PNG:', err);
  });
