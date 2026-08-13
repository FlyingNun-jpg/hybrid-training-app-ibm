# Hybrid Athlete Training App — IBM Edition

A hybrid-athlete training app that interleaves structured progressive strength programming with AI-generated running/Hyrox plans. Built with **Next.js 16**, **Supabase**, and **IBM WatsonX.ai** (Granite).

## IBM Technology Used

| IBM Service | Role in the App |
|---|---|
| **WatsonX.ai** | AI-powered training plan generation and post-workout coach feedback |
| **IBM Granite 3.3 8B Instruct** | Foundation model driving all AI features — chosen for enterprise trust, transparency and fast inference |

## Getting Started

### 1. Prerequisites

- Node.js 18+
- An IBM Cloud account — [cloud.ibm.com](https://cloud.ibm.com) (free tier works)
- A Supabase project — [supabase.com](https://supabase.com) (free tier works)

### 2. IBM WatsonX Setup (15 minutes)

#### a. Get your IBM Cloud API Key
1. Go to [cloud.ibm.com → Manage → Access (IAM) → API keys](https://cloud.ibm.com/iam/apikeys)
2. Click **Create an IBM Cloud API key**
3. Give it a name (e.g. `hybrid-app-key`) and copy the key value immediately — it is only shown once

#### b. Create a WatsonX.ai Project
1. Go to [dataplatform.cloud.ibm.com](https://dataplatform.cloud.ibm.com) and sign in with your IBM Cloud account
2. Click **New project** → **Create an empty project**
3. Name it (e.g. `hybrid-training`) and click **Create**
4. Once created, go to the **Manage** tab → **General** section → copy the **Project ID**

#### c. Note your regional endpoint
Match the region you selected when creating the project:
- Dallas: `https://us-south.ml.cloud.ibm.com`
- Frankfurt: `https://eu-de.ml.cloud.ibm.com`
- London: `https://eu-gb.ml.cloud.ibm.com`
- Tokyo: `https://jp-tok.ml.cloud.ibm.com`

#### d. Add to .env.local
```
WATSONX_API_KEY=<your IBM Cloud API key>
WATSONX_PROJECT_ID=<your WatsonX project ID>
WATSONX_URL=https://us-south.ml.cloud.ibm.com
```

### 3. Install dependencies
```bash
npm install
```

### 4. Run the development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Why IBM Granite?

IBM's Granite models are open-weights foundation models built for enterprise use. In a health/fitness context this matters: the model's decisions (why it recommended a deload week, why it adjusted pacing) need to be **auditable and trustworthy** — not a black box. Granite is designed from the ground up with that enterprise transparency in mind.

WatsonX.ai wraps Granite with:
- **Managed inference** with SLA-backed availability
- **IAM-based access control** — the same identity layer that governs all IBM Cloud services
- **Guardrails** built into the platform (content filtering, bias detection)
- **Usage tracking** so you can see exactly what was sent and generated

## Architecture

```
User → Next.js App Router
           ├── /api/coach         → WatsonX Granite (post-workout feedback)
           ├── /api/generate-plan → WatsonX Granite (12-16 week plan generation)
           ├── /api/adjust-plan   → WatsonX Granite (adaptive plan easing)
           └── /api/strava/*      → Strava OAuth
Supabase → Auth + Database (plans, logs, profiles)
```

## Features

- **AI Training Plan Generation** — WatsonX Granite generates 8-16 week Hyrox, Marathon, Half Marathon, 5K and Hybrid plans with proper periodization, VDOT pacing, and deterministic volume enforcement
- **Post-Workout AI Coach** — Granite gives warm, specific post-workout feedback grounded in what you actually logged
- **Adaptive Plan Adjustment** — Detects overreaching from your logs and automatically eases the upcoming week
- **Progressive Strength Builder** — Build your own recurring strength template with proper progressive overload, e1RM tracking, and compound lift PBs
- **Strava Sync** — Log workouts back to Strava automatically
- **Daily Push Reminders** — Web push notifications for your training schedule
