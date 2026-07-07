# Dad Health

Dad Health is a web application designed to help dads improve their physical health, mental wellbeing, and family life. It brings together fitness, mindfulness, parenting tools, and a supportive community in one place.

## Tech Stack

* Next.js 14
* React 18
* TypeScript
* Tailwind CSS
* Supabase
* Stripe
* OneSignal
* PostHog
* Vercel

## Getting Started

Clone the project:

```bash
git clone https://github.com/khushi0433/dadHealth
cd dadhealth
```

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env.local
```

Start the development server:

```bash
npm run dev
```

The app will be available at:

```
http://localhost:3000
```

## Environment Variables

Add the required environment variables to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_ONESIGNAL_APP_ID=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=

STRIPE_SECRET_KEY=
RESEND_API_KEY=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

## Project Structure

```
app/
components/
lib/
public/
styles/
```

## Useful Commands

```bash
npm run dev      # Development
npm run build    # Production build
npm run start    # Start production
npm run lint     # Lint project
```

## Deployment

The project is deployed on Vercel.

Any changes pushed to the `main` branch will automatically trigger a new deployment.

## Support

If you're taking over this project, refer to the handover document for deployment details, third-party services, and account access.

---

Developed by **Khushbu Baloch** for **Dad Health**.
