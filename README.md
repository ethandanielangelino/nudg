# ⏰ Nudg — AI-Powered Schedule & Multi-Channel Reminder Assistant

**Nudg** is a modern personal assistant web app built with Next.js, Tailwind CSS, Supabase, and Google Gemini AI. It lets you manage your schedule, create events in natural language when in a hurry, check your future agenda with continuous conversation memory, and receive smart reminders via **WhatsApp**, **Telegram**, **Discord**, or **Email (Gmail)**.

---

## 🚀 Key Features

- **Landing Page**: Fully responsive with dark/light mode, smooth Framer Motion animations, interactive feature highlights, and clear onboarding.
- **AI Personal Assistant (`/chat`)**:
  - Speaks natural language to answer schedule inquiries.
  - Automatically parses requests like *"Coffee with Alex tomorrow at 3pm"* and inserts them directly into your calendar.
  - Retains persistent conversation memory stored in your database.
- **Interactive Calendar (`/calendar`)**:
  - Full-featured monthly and weekly grid.
  - Color-coded event tags, date navigation, and event inspection modals.
- **Quick Nudge Dashboard (`/dashboard`)**:
  - Today's agenda view with real-time status.
  - One-line AI schedule bar for instant event creation.
  - Upcoming 7-day timeline.
- **Multi-Channel Reminders (`/settings`)**:
  - ✉️ **Gmail (SMTP)**: 100% Free via standard Google App Password.
  - 💬 **Telegram Bot**: 100% Free instant alerts using Telegram Bot API.
  - 🎮 **Discord Webhook**: 100% Free instant server or direct channel notifications.
  - 📱 **WhatsApp (Meta Cloud API)**: Up to 1,000 free service conversations per month.
  - One-click **Test Notification** button on each channel to verify delivery.

---

## 🛠️ Tech Stack (100% Free Tier Compatible)

| Component | Technology | Cost / Free Tier |
|---|---|---|
| **Framework** | Next.js 16 (App Router, TypeScript) | Open Source / Free on Vercel |
| **Styling** | Tailwind CSS + Framer Motion + Lucide Icons | Open Source |
| **Database & Auth** | Supabase (PostgreSQL + Auth) | Free (500MB DB, 50,000 MAU) |
| **AI Brain** | Google Gemini API (`@google/genai`) | Free tier on Google AI Studio |
| **Email Reminders** | Nodemailer (Gmail SMTP) | Requires sender credentials |
| **Telegram Reminders**| Telegram Bot API | Requires a bot token |
| **Discord Reminders** | Discord Webhooks | Requires a webhook URL |
| **WhatsApp Reminders**| Meta Cloud API | Requires a business setup; Meta pricing and template rules apply |

---

## ⚡ Quick Start Setup

### 1. Database Setup (Supabase)
1. Go to [supabase.com](https://supabase.com) and create a free project.
2. In the Supabase dashboard, open the **SQL Editor**.
3. Copy and run the entire contents of `supabase/migration.sql` located in this project.
4. Run `supabase/settings-migration.sql` in the SQL Editor. It adds persisted alert timing, channel uniqueness, and the retry fields used by the reminder worker.
5. Run `supabase/professional-events-migration.sql` in the SQL Editor. It adds event priority, category, organization, project, and per-event reminder timing. Events set to “Use account default” continue to follow your reminder preference.
6. Run `supabase/event-actions-migration.sql` in the SQL Editor. It enables reminder links to mark an event attended, completed, or cancelled, and records reminder delivery time.
7. Run `supabase/reminder-delivery-migration.sql`. This safely upgrades the status options and adds per-channel delivery timestamps, whether or not step 6 was run earlier.
8. Go to **Project Settings -> API** to copy:
   - `Project URL`
   - `publishable key` (never use a `secret` key in browser config)

### 2. Configure Environment Variables
Copy `.env.local.example` to `.env.local`:
```bash
cp .env.local.example .env.local
```
Fill in the values:

```env
# 1. Supabase (Required for Auth & Data)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key

# Server only. Use a newly rotated key; never use the exposed key from chat.
SUPABASE_SECRET_KEY=your-rotated-supabase-secret-key
CRON_SECRET=long-random-cron-secret
# Generate once with: openssl rand -base64 32
CHANNEL_CONFIG_ENCRYPTION_KEY=base64-encoded-32-byte-key

# 2. Google Gemini AI (Required for AI Assistant)
# Get a free key at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash

# 3. Email Reminders (Free Gmail SMTP)
# Create an App Password at: https://myaccount.google.com/apppasswords
SMTP_EMAIL=your-email@gmail.com
SMTP_APP_PASSWORD=your-16-char-app-password

# 4. Telegram Reminders (Free)
# Create a bot via @BotFather on Telegram to get your token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# 5. Discord Reminders
# Save a webhook URL per user from Settings; Nudg encrypts it server-side.

# 6. WhatsApp Reminders (Meta Cloud API)
# Get credentials at: https://developers.facebook.com/
WHATSAPP_ACCESS_TOKEN=your_whatsapp_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_API_VERSION=v27.0
# Optional approved template with three body placeholders: title, description, local time
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANGUAGE=en_US

# 7. App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to see your app live!

Chat keeps a private per-user conversation history and rolling memory summary. Reminder messages include a signed event-management link. Email, Telegram, and Discord display a **Manage event** button; WhatsApp displays a clickable link, and an approved WhatsApp template can render it as a URL button by setting `WHATSAPP_TEMPLATE_MANAGE_BUTTON_INDEX` to the template button index. Set `NEXT_PUBLIC_APP_URL` to the deployed site URL for production links.

Production reminder delivery runs through the Vercel Cron schedule in `vercel.json` (once per minute). Add `CRON_SECRET`, `SUPABASE_SECRET_KEY`, and the same `CHANNEL_CONFIG_ENCRYPTION_KEY` to the deployment environment. Local development does not run Vercel Cron automatically.

---

## 📂 Project Structure

```
nudg/
├── supabase/
│   └── migration.sql              # Complete database schema & RLS policies
├── src/
│   ├── app/
│   │   ├── (landing)/             # Modern animated marketing home page
│   │   ├── (auth)/                # Login, Signup, OAuth callback
│   │   ├── (dashboard)/
│   │   │   ├── dashboard/         # Overview metrics, today's schedule, quick add
│   │   │   ├── calendar/          # Interactive month & week grid
│   │   │   ├── chat/              # AI Assistant chat with persistent memory
│   │   │   └── settings/          # WhatsApp, Telegram, Discord, Email configuration
│   │   ├── api/
│   │   │   ├── chat/              # Gemini AI parsing & conversation logic
│   │   │   ├── events/            # Events CRUD
│   │   │   └── reminders/         # Dispatcher for all 4 notification channels
│   │   ├── globals.css            # Dark/light theme design system
│   │   └── layout.tsx             # Root layout with ThemeProvider
│   ├── components/
│   │   └── theme-provider.tsx     # SSR-safe dark/light mode toggle
│   └── lib/
│       ├── notifications.ts       # WhatsApp, Telegram, Discord, Email sender functions
│       ├── types.ts               # TypeScript interfaces
│       ├── utils.ts               # Tailwind helpers
│       └── supabase/              # Browser, server & proxy clients
```
