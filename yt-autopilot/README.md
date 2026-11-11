# YT AutoPilot — Drive se YouTube, roz automatic

Ye ek self-hosted tool hai jo:

1. Google Drive se video files uthata hai (single file link ya poora folder link),
2. unka **title, description aur tags** trending keywords + AI se bhar deta hai,
3. **roz 5 videos** (configurable) apne set kiye hue time slots par YouTube par publish karta hai — bina aapke kuch kiye.

Aapko sirf ek baar Google Cloud me OAuth credentials banana hai aur channel connect karna hai. Uske baad ye chalta rehta hai.

> Ye folder is repo ke main Lovable app se **alag** hai — iska apna `package.json` aur apna server hai. Isko chalane ke liye kisi bhi chhoti Node.js machine (VPS, Render, Railway, apna laptop) par deploy karo.

---

## 1. Chalao (local)

```sh
cd yt-autopilot
npm install
cp .env.example .env      # values bharo (neeche dekho)
npm start                 # http://localhost:3001
```

`DATA_DIR` (default `./data/state.json`) me queue, settings, logs aur Google tokens save hote hain.
Isi folder ko backup rakho aur public git me commit mat karo.

## 2. Google Cloud setup (ek baar, ~5 minute)

1. [Google Cloud Console](https://console.cloud.google.com/projectcreate) par naya project banao.
2. **APIs & Services → Library** → enable karo:
   - **YouTube Data API v3** (upload ke liye)
   - **Google Drive API** (videos padhne ke liye)
3. **OAuth consent screen** → External → app name + apna email → **Test users** me apna Google email add karo.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
5. **Authorized redirect URIs** me exact URL daalo:
   - local: `http://localhost:3001/api/google/callback`
   - hosted: `https://<aapka-domain>/api/google/callback`
6. Client ID aur Client Secret `.env` me:

```env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
```

7. Server restart karo → dashboard par **Connect YouTube + Drive** button aa jayega.
   Google account wahi choose karo jiske paas channel aur Drive videos hain.

## 3. Uske baad dashboard par

- **Add videos** tab me Drive file link ya folder link paste karo → Import.
  Har video ko automatically aaj/tomorrow ka slot assign hota hai (roz 5 slots).
- **Settings** me slots, privacy, category, AI title/tags, description template badal sakte ho.
- **Publish queue** me kisi bhi video ka title/tags/time edit kar sakte ho, `Publish now` se turant bhej sakte ho.
- Har 30 second scheduler check karta hai: due videos download → upload. Progress **Activity** log me dikhti hai.

### Kaam kaise karta hai (behind the scenes)

- Har item ka `publishAt` slot hota hai.
- Slot se `uploadLeadMinutes` (default 30 min) pehle video upload ho jaati hai; agar slot abhi aage hai to
  YouTube par `private + publishAt` set hota hai — matlab **YouTube khud exact time par public karega**, server
  thodi der band ho to bhi publish nahi rukta.
- Fetch fail hone par 10 min baad tak automatic retry (max 3 baar). Quota error par retry nahi hota.
- Folder import duplicate videos ko skip karta hai (Drive file ID ke basis par).

---

## 4. Public hosting (optional)

Kahin bhi host karo jahan Node 20+ chale aur **disk persist** ho (queue + tokens disk par hain):

- **VPS** — `npm install --omit=dev && npm start`, process manager (systemd/pm2) se chalao.
- **Render / Railway / Fly.io** — service banao, `yt-autopilot` root directory do, persistent volume mount karo,
  aur `DATA_DIR` us volume par point karo.

Hosting se pehle **zaroor**:

```env
APP_PASSWORD=<lamba password>
SESSION_SECRET=<random string>
TZ=Asia/Kolkata
```

`APP_PASSWORD` set na ho to dashboard khula rahega — koi bhi aapke channel par upload kar sakta hai.
Ek hi instance chalao (do instance ek hi `state.json` par likhenge to queue corrupt ho sakti hai).

---

## 5. AI titles/tags (optional)

```env
AI_BASE_URL=https://freebuff.com/api/v1/paid
AI_API_KEY=<aapki key>
AI_MODEL=gpt-4o-mini
```

Key na ho to bhi titles/tags band nahi hote — trending keywords + filename se ban jaate hain,
bas AI jitne natural nahi lagte. Key sirf server side use hoti hai, browser me kabhi nahi jaati.

---

## 6. Important limits (janna zaroori)

| Cheez | Limit |
| --- | --- |
| YouTube API quota | default **10,000 units/day**; ek upload = **1,600 units** → **max 6 uploads/day** |
| Isliye 5 videos/day | default quota me fit (5 × 1600 = 8000 + reads) |
| Zyada videos chahiye | Google Cloud → APIs & Services → YouTube Data API v3 → **Quota** se increase request karo |
| File size | YouTube par 256 GB / 12 ghante tak; Drive download + upload me time lagta hai |
| Naye channel | Bade uploads ke liye phone verification + 24 ghante ka pehla-upload wait lag sakta hai |

`videosPerDay` ko 6 se zyada na rakho jab tak quota increase na mila ho — warna uploads
`quotaExceeded` se fail hongi (dashboard log me dikhega).

---

## 7. Troubleshooting

| Problem | Wajah / fix |
| --- | --- |
| `redirect_uri_mismatch` | Google Console me redirect URI exactly wahi URL daalo jo dashboard **Setup** card me dikh raha hai. |
| `Drive ke liye YouTube connect karo` | Channel connect nahi hai, ya `.env` me `GOOGLE_API_KEY` nahi hai. |
| `The user does not have sufficient permissions` | Drive file/folder wahi account se share karo jo connect kiya hai. |
| `quotaExceeded` | Daily YouTube quota khatam. Kal ka wait karo ya quota increase lo. |
| `invalid_grant` / `Token has been expired or revoked` | Google ne refresh token revoke kar diya. Disconnect → phir se Connect karo. |
| Upload `0 bytes` | File download nahi hui — sharing permission check karo. |
| Time galat aa raha hai | `TZ` env (default `Asia/Kolkata`) set karke restart karo; slots usi time zone me hain. |

## 8. API (agar automation karni ho)

| Method | Path | Kaam |
| --- | --- | --- |
| GET | `/api/status` | channel, settings, stats, logs |
| GET | `/api/queue` | queue items |
| POST | `/api/queue` | `{ "input": "<drive links>" }` — add + auto metadata |
| PATCH | `/api/queue/:id` | title/tags/description/publishAt/privacy edit |
| POST | `/api/queue/:id/publish-now` | turant upload |
| POST | `/api/queue/:id/retry` | failed item retry |
| POST | `/api/queue/:id/regenerate` | title/tags dobara generate |
| DELETE | `/api/queue/:id` | queue se hatao |
| PUT | `/api/settings` | videosPerDay, slots, privacy, category, AI on/off |
| GET | `/api/logs` | activity log |
