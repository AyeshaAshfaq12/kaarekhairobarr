# Kaare Khair o Barr - Frontend Setup Guide

## Quick Start

### Prerequisites
- Node.js 18+ and npm/yarn
- npm or yarn package manager

### Local Development Setup

#### 1. Install Dependencies
```bash
npm install
# or
yarn install
```

#### 2. Configure Environment
```bash
cp .env.example .env.local
# Edit .env.local if needed
```

Default:
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
```

Firebase note:
- The homepage renders with styled fallback content until Firebase env vars are added.
- Firestore powers live homepage reads once configured.
- The support form writes submissions into `supportRequests`.

#### 3. Run Development Server
```bash
npm run dev
# or
yarn dev
```

Navigate to `http://localhost:3000`

---

## Project Structure

```
frontend/
├── src/
│   ├── app/              # Next.js 13+ app directory
│   │   ├── layout.tsx    # Root layout
│   │   ├── page.tsx      # Home page
│   │   ├── globals.css   # Global styles
│   │   ├── campaigns/    # Campaign pages
│   │   ├── donate/       # Donation form
│   │   ├── events/       # Events pages
│   │   ├── about/        # About page
│   │   ├── blog/         # Blog pages
│   │   ├── contact/      # Contact form
│   │   ├── volunteer/    # Volunteer form
│   │   ├── gallery/      # Gallery pages
│   │   ├── impact/       # Impact/stats pages
│   │   └── dashboard/    # Admin dashboard
│   ├── components/       # Reusable components
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── Providers.tsx
│   │   ├── CampaignCard.tsx
│   │   ├── DonationForm.tsx
│   │   ├── EventCard.tsx
│   │   ├── Charts/       # Chart components
│   │   └── ...
│   ├── services/
│   │   └── api.ts        # API client
│   ├── hooks/            # Custom React hooks
│   └── styles/           # Additional styles
├── public/               # Static assets
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── next.config.js
└── .env.example
```

---

## Available Scripts

```bash
# Development
npm run dev

# Production build
npm run build

# Start production server
npm start

# Type checking
npm run type-check

# Linting
npm run lint
```

---

## Building Pages

### 1. Create Page Component
```tsx
// src/app/my-page/page.tsx
export default function MyPage() {
  return (
    <div className="container-custom py-12">
      <h1 className="text-4xl font-bold mb-6">My Page</h1>
      {/* Content */}
    </div>
  )
}
```

### 2. Use API Service
```tsx
'use client'

import { useEffect, useState } from 'react'
import { apiService } from '@/services/api'

export default function CampaignsList() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiService.getCampaigns()
      .then(res => setCampaigns(res.data.results))
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div>Loading...</div>
  
  return (
    <div>
      {campaigns.map(campaign => (
        <div key={campaign.id} className="card">
          <h3>{campaign.title}</h3>
        </div>
      ))}
    </div>
  )
}
```

### 3. Create Reusable Component
```tsx
// src/components/CampaignCard.tsx
'use client'

interface CampaignCardProps {
  title: string
  description: string
  targetAmount: number
  raisedAmount: number
  progress: number
}

export default function CampaignCard({
  title,
  description,
  targetAmount,
  raisedAmount,
  progress,
}: CampaignCardProps) {
  return (
    <div className="card">
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-600 mb-4">{description}</p>
      <div className="bg-gray-200 rounded-full h-2 mb-2">
        <div
          className="bg-primary-600 h-2 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-sm text-gray-600">
        PKR {raisedAmount.toLocaleString()} of {targetAmount.toLocaleString()}
      </div>
    </div>
  )
}
```

---

## Styling

### Tailwind CSS Classes

Primary colors are defined in `tailwind.config.js`:
- `bg-primary-600` - Primary green
- `bg-accent-500` - Accent gold
- `text-primary-600` - Primary text color

### Custom Components
```tsx
// Predefined classes in globals.css
<button className="btn-primary">Donate</button>
<button className="btn-secondary">Join</button>
<button className="btn-outline">Learn More</button>
<div className="card">Content</div>
<div className="container-custom">Centered container</div>
```

---

## Form Handling

Using React Hook Form for type-safe forms:

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { apiService } from '@/services/api'
import toast from 'react-hot-toast'

export default function DonationForm() {
  const { register, handleSubmit, formState: { errors } } = useForm()

  const onSubmit = async (data: any) => {
    try {
      await apiService.createDonation(data)
      toast.success('Thank you for your donation!')
    } catch (err) {
      toast.error('Failed to process donation')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <input
        {...register('donor_name', { required: 'Name is required' })}
        placeholder="Full Name"
        className="w-full p-3 border rounded-lg"
      />
      {errors.donor_name && <span className="text-red-500">{errors.donor_name.message}</span>}

      <input
        {...register('email', { required: 'Email is required' })}
        type="email"
        placeholder="Email"
        className="w-full p-3 border rounded-lg"
      />

      <input
        {...register('amount', { required: 'Amount is required' })}
        type="number"
        placeholder="Donation Amount (PKR)"
        className="w-full p-3 border rounded-lg"
      />

      <button type="submit" className="btn-primary w-full">
        Donate Now
      </button>
    </form>
  )
}
```

---

## Firebase Collections Used by the Homepage

When Firebase is configured, the homepage reads from these Firestore locations:

- `siteContent/homepage`
  - Suggested fields: `badge`, `heroTitle`, `heroSubtitle`, `mission`, `vision`, `contactEmail`, `contactPhone`, `contactAddress`, `statCards`, `principles`
- `campaigns`
  - Suggested fields: `title`, `shortDescription` or `short_description`, `category`, `targetAmount` or `target_amount`, `raisedAmount` or `raised_amount`, `beneficiariesLabel`, `featured`, `accent`
- `events`
  - Suggested fields: `title`, `description`, `eventDate` or `event_date`, `location`, `category`, `status`
- `testimonials`
  - Suggested fields: `name`, `role`, `content`, `highlight`, `featured`

The support form writes to:

- `supportRequests`
  - Stored fields: `fullName`, `email`, `phone`, `interest`, `message`, `createdAt`, `source`

---

## Charts & Analytics

Using Recharts:

```tsx
'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

export default function DonationChart({ data }) {
  return (
    <BarChart width={600} height={300} data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis />
      <Tooltip />
      <Bar dataKey="amount" fill="#22c55e" />
    </BarChart>
  )
}
```

---

## Images & Media

```tsx
import Image from 'next/image'

export default function CampaignBanner() {
  return (
    <Image
      src="http://localhost:8000/media/campaigns/banner.jpg"
      alt="Campaign banner"
      width={800}
      height={400}
      className="rounded-lg"
    />
  )
}
```

---

## Environment Variables

Add to `.env.local`:

```
# API
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

# Analytics (optional)
NEXT_PUBLIC_GA_ID=

# Stripe (for future)
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=
```

---

## Deployment on Vercel

1. **Connect Repository**
   - Go to https://vercel.com
   - Import GitHub repository
   - Select `/frontend` as root directory

2. **Environment Variables**
   - Add `NEXT_PUBLIC_API_BASE_URL` = production backend URL
   - Add the `NEXT_PUBLIC_FIREBASE_*` values from your Firebase web app configuration

3. **Deploy**
   - Vercel automatically builds and deploys
   - Automatic deployments on push to main

4. **Custom Domain**
   - Add domain in Vercel settings

---

## Performance Optimization

1. **Image Optimization**
   - Use Next.js Image component
   - Automatic responsive images

2. **Code Splitting**
   - Next.js automatically splits code per route
   - Reduces initial bundle size

3. **Caching**
   - Static pages cached
   - ISR for frequently updated content

4. **Monitoring**
   - Vercel Analytics built-in
   - Monitor Core Web Vitals

---

## Best Practices

1. **Use 'use client' for interactive components**
2. **Keep components small and reusable**
3. **Use TypeScript for type safety**
4. **Handle loading and error states**
5. **Validate forms before submission**
6. **Use environment variables for config**
7. **Optimize images for web**
8. **Mobile-first responsive design**
9. **Accessible components (ARIA labels)**
10. **Test in multiple browsers**

---

## Troubleshooting

### Build Fails
```bash
# Clear cache
rm -rf .next
npm run build
```

### API Connection Issues
```
Check NEXT_PUBLIC_API_BASE_URL in .env.local
Check NEXT_PUBLIC_FIREBASE_PROJECT_ID and other Firebase env vars in .env.local
Verify backend is running and CORS is configured
Check browser console for errors
```

### Styling Issues
```bash
# Rebuild CSS
rm -rf .next
npm run build
```

### Type Errors
```bash
npm run type-check
# Fix any TypeScript errors
```

---

## Resources

- Next.js Docs: https://nextjs.org/docs
- Tailwind CSS: https://tailwindcss.com/docs
- React Hook Form: https://react-hook-form.com
- Recharts: https://recharts.org
- Vercel Deployment: https://vercel.com/docs

---

Built with ❤️ for Kaare Khair o Barr

---

## Member Portal (`/portal`)

A members-only portal built from `docs/KKB Portal — Build Spec.pdf`. It lives in this same Next.js app:
the public site moved into the `src/app/(site)` route group (URLs unchanged) and the portal is under
`src/app/portal`. Server code lives in `src/lib/portal`. Decisions, progress and open items are recorded
in `docs/portal/PORTAL_PROGRESS.md`.

**Status: all four phases are built.**
1. Foundation: accounts, the NDA, approval, the hierarchy, roles, teams, audit and notifications.
2. Money: cases, donors, outreach, donations and verification, targets, metrics, monthly close and dashboards.
3. Work and events: tasks and Kanban, events and expenses, and seven reports with Excel/PDF export.
4. WhatsApp: notifications and quick logging. This still needs Meta credentials to go live.

### Setup

```bash
cp .env.example .env.local      # fill DATABASE_URL and CNIC_ENCRYPTION_KEY at minimum
npm install                     # also runs prisma generate
npm run db:deploy               # apply migrations (or `npm run db:migrate` while developing)
npm run db:seed                 # roles, teams, NDA v1, checklist, people, cases, donors,
                                # outreach, donations, targets, tasks and an event
npm run dev                     # http://localhost:3000/portal
```

Seed logins: `admin@kkb.test` (SuperAdmin), `finance@kkb.test`, `lead1..3@kkb.test`, `sub1..2@kkb.test`,
`m1..m15@kkb.test`, all with password `kkb-portal-dev` (override with `SEED_PASSWORD`).
- Without `RESEND_API_KEY`, emails (verification links, resets, invites, notifications) are printed to the server log.
- Without `S3_BUCKET`, uploads go to `./.uploads` (gitignored).
- Without the `WHATSAPP_*` settings, WhatsApp stays off.

### Tests

```bash
npm test                        # Vitest: authorize() across every scope, every §9.2 metric, rollups,
                                # validation, crypto, months, WhatsApp parser and signatures.
                                # DB-backed suites (subtree CTE, donor dedupe) run when
                                # TEST_DATABASE_URL is set
npm run build && npm run test:e2e   # Playwright at 375 px: onboarding, access, offboarding, money,
                                    # events/expenses, tasks, exports, WhatsApp webhook, and a smoke
                                    # test of every screen. Needs E2E_DATABASE_URL (defaults to
                                    # TEST_DATABASE_URL), which is WIPED and re-seeded on every run
```

### Cron

`vercel.json` schedules these routes. Each needs the header `Authorization: Bearer $CRON_SECRET`:

| Route | When | What |
|---|---|---|
| `/api/portal/cron/nightly` | 03:00 PKT | Monthly close: snapshot the previous month on days 1–10, freeze on day 11. Also the digest of donations pending over 3 days, and copying recurring tasks. Add `?at=<ISO date>` to replay as of a moment (backfills). |
| `/api/portal/cron/morning` | 08:00 PKT | Follow-ups due today, and tasks due tomorrow or overdue. |
| `/api/portal/cron/purge-unverified` | daily | Deletes accounts left unverified for 7+ days. |

### WhatsApp (optional)

1. Create a WhatsApp Cloud API app and phone number in Meta.
2. Get a template approved with two body parameters: `{{1}}` title and `{{2}}` details/link.
3. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE` and `WHATSAPP_TEMPLATE_LANGUAGE`.
4. Point the webhook at `https://<host>/api/portal/whatsapp/webhook`.

Members opt in under Settings → WhatsApp. Organisation settings shows the connection status and the latest messages.
