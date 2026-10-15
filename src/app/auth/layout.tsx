import { HeroSky } from "@/components/sky/HeroSky";

/**
 * Every auth screen (sign in, sign up, password reset, profile completion,
 * onboarding) sits under the live sky: a quiet version of the landing page's,
 * stars and the hills along the foot of the page, with the form on its solid
 * card above it so no field ever sits on the scene.
 *
 * The sky is positioned in the page, not fixed to the screen. When a phone's
 * keyboard opens, the hills scroll away beneath it instead of riding up over
 * the password field, which is how the chat composer's keyboard trouble began.
 *
 * `pb-28` keeps a centered card from covering the hills on a short page.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate min-h-screen bg-bg-primary flex items-center justify-center p-4 pb-28 lg:p-8 lg:pb-32">
      <div className="absolute inset-0 -z-10">
        <HeroSky />
      </div>
      {children}
    </div>
  );
}
