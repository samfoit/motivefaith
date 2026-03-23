import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | MotiveFaith",
};

export default function PrivacyPage() {
  return (
    <div className="space-y-8 text-[var(--color-text-primary)]">
      <header>
        <h1 className="font-display text-3xl font-bold mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          Last updated: February 23, 2026
        </p>
      </header>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          1. Information We Collect
        </h2>
        <p>We collect the following types of information:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium text-[var(--color-text-primary)]">
              Account information:
            </span>{" "}
            name, email address, username, date of birth, and password
          </li>
          <li>
            <span className="font-medium text-[var(--color-text-primary)]">
              User content:
            </span>{" "}
            photos, videos, and messages you upload as habit completions
          </li>
          <li>
            <span className="font-medium text-[var(--color-text-primary)]">
              Usage data:
            </span>{" "}
            habit completion times, streak data, feature usage, and device
            information
          </li>
          <li>
            <span className="font-medium text-[var(--color-text-primary)]">
              Timezone:
            </span>{" "}
            your browser&apos;s timezone for accurate date handling
          </li>
        </ul>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          2. How We Use Your Information
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>To provide and operate the Service</li>
          <li>To track your habits, streaks, and completions</li>
          <li>
            To share your progress with your accountability partners (friends
            you choose to share with)
          </li>
          <li>To send push notifications about encouragements and missed habits</li>
          <li>To improve and develop new features</li>
          <li>To enforce our Terms of Service and prevent abuse</li>
        </ul>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          3. Data Storage
        </h2>
        <p>
          Your data is stored securely using Supabase infrastructure. Photos and
          videos are stored in encrypted cloud storage. Database records are
          protected by row-level security policies that ensure users can only
          access their own data and data shared with them by accountability
          partners.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          4. Data Retention
        </h2>
        <p>
          We retain your data for as long as your account is active. Habit
          completion evidence (photos/videos) is retained for the lifetime of
          your account unless you delete individual completions. When you delete
          your account, all associated data is permanently removed within 30
          days.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          5. Third-Party Sharing
        </h2>
        <p>
          We do not sell your personal information. We may share data with:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium text-[var(--color-text-primary)]">
              Infrastructure providers:
            </span>{" "}
            for hosting, storage, and authentication services
          </li>
          <li>
            <span className="font-medium text-[var(--color-text-primary)]">
              Law enforcement:
            </span>{" "}
            when required by law or to report illegal content (e.g., CSAM reports
            to NCMEC)
          </li>
        </ul>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          6. Your Rights (GDPR)
        </h2>
        <p>
          If you are in the European Economic Area, you have the right to:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Access your personal data</li>
          <li>Rectify inaccurate personal data</li>
          <li>Request erasure of your personal data</li>
          <li>Request data portability</li>
          <li>Object to or restrict processing of your data</li>
        </ul>
        <p>
          To exercise these rights, contact us at{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            privacy@motivefaith.app
          </span>
          .
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          7. Your Rights (CCPA)
        </h2>
        <p>
          If you are a California resident, you have the right to:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Know what personal information is collected</li>
          <li>Know whether your personal information is sold or disclosed</li>
          <li>Request deletion of your personal information</li>
          <li>Not be discriminated against for exercising your rights</li>
        </ul>
        <p>We do not sell personal information.</p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          8. Children&apos;s Privacy (COPPA)
        </h2>
        <p>
          MotiveFaith is not intended for children under 13 years of age. We do not
          knowingly collect personal information from children under 13. If we
          learn that we have collected personal information from a child under
          13, we will delete that information promptly.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          9. Data Deletion Requests
        </h2>
        <p>
          You can delete your account and all associated data through your
          profile settings. You may also request data deletion by contacting{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            privacy@motivefaith.app
          </span>
          . We will process deletion requests within 30 days.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          10. Changes to This Policy
        </h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you
          of material changes by posting the updated policy with a revised
          &quot;Last updated&quot; date. Your continued use of the Service after
          changes constitutes acceptance of the revised policy.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          11. Contact
        </h2>
        <p>
          For privacy-related questions, contact us at{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            privacy@motivefaith.app
          </span>
          .
        </p>
      </section>
    </div>
  );
}
