import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | MotiveFaith",
};

export default function TermsPage() {
  return (
    <div className="space-y-8 text-[var(--color-text-primary)]">
      <header>
        <h1 className="font-display text-3xl font-bold mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          Last updated: February 23, 2026
        </p>
      </header>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          1. Acceptance of Terms
        </h2>
        <p>
          By creating an account or using MotiveFaith (&quot;the Service&quot;), you
          agree to be bound by these Terms of Service (&quot;Terms&quot;). If you
          do not agree, do not use the Service.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          2. Eligibility
        </h2>
        <p>
          You must be at least 13 years old to use the Service. By creating an
          account, you represent that you are at least 13 years of age. If you
          are under 18, you represent that your parent or legal guardian has
          reviewed and agreed to these Terms on your behalf.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          3. User Content
        </h2>
        <p>
          You retain ownership of content you upload to the Service (photos,
          videos, messages). By uploading content, you grant MotiveFaith a
          non-exclusive, worldwide, royalty-free license to store, display, and
          distribute your content solely for the purpose of operating and
          improving the Service.
        </p>
        <p>
          You are solely responsible for all content you upload and represent
          that you have the right to share such content.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          4. Prohibited Content
        </h2>
        <p>You may not upload, post, or share content that:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Depicts, promotes, or facilitates child sexual abuse material (CSAM)
          </li>
          <li>
            Contains non-consensual intimate imagery of any person
          </li>
          <li>Infringes on the copyrights or intellectual property rights of others</li>
          <li>Is illegal under applicable law</li>
          <li>Constitutes harassment, threats, or abuse directed at any person</li>
          <li>Contains spam, malware, or deceptive content</li>
        </ul>
        <p>
          MotiveFaith has zero tolerance for CSAM. Any such content will be
          immediately removed and reported to the National Center for Missing
          &amp; Exploited Children (NCMEC) and law enforcement.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          5. Content Moderation
        </h2>
        <p>
          MotiveFaith reserves the right to review, remove, or disable access to any
          content that violates these Terms, at our sole discretion. We may also
          suspend or terminate accounts that repeatedly or egregiously violate
          these Terms.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          6. DMCA / Copyright Infringement
        </h2>
        <p>
          If you believe your copyrighted work has been infringed on the Service,
          please follow the procedures outlined in our{" "}
          <a
            href="/legal/dmca"
            className="text-[var(--color-brand)] hover:text-[var(--color-brand-hover)] underline"
          >
            DMCA Policy
          </a>
          .
        </p>
        <p>
          MotiveFaith implements a repeat infringer policy and will terminate accounts
          of users who are repeat copyright infringers.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          7. TAKE IT DOWN Act Compliance
        </h2>
        <p>
          In accordance with the TAKE IT DOWN Act, if you are a victim of
          non-consensual intimate imagery appearing on the Service, you may
          request its removal. MotiveFaith will remove reported intimate imagery
          within 48 hours of receiving a valid request. To submit a removal
          request, email{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            legal@motivefaith.app
          </span>{" "}
          with the subject line &quot;TAKE IT DOWN Removal Request.&quot;
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          8. Account Termination
        </h2>
        <p>
          We may suspend or terminate your account at any time for violations of
          these Terms. You may delete your account at any time through your
          profile settings. Upon deletion, your data will be removed in
          accordance with our{" "}
          <a
            href="/legal/privacy"
            className="text-[var(--color-brand)] hover:text-[var(--color-brand-hover)] underline"
          >
            Privacy Policy
          </a>
          .
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          9. Limitation of Liability
        </h2>
        <p>
          The Service is provided &quot;as is&quot; without warranties of any
          kind, either express or implied. MotiveFaith shall not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or
          any loss of profits or revenues, whether incurred directly or
          indirectly, or any loss of data, use, goodwill, or other intangible
          losses resulting from your use of the Service.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          10. Indemnification
        </h2>
        <p>
          You agree to indemnify and hold harmless MotiveFaith, its officers,
          directors, employees, and agents from any claims, liabilities, damages,
          losses, or expenses arising out of your use of the Service or your
          violation of these Terms.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          11. Changes to These Terms
        </h2>
        <p>
          We may update these Terms from time to time. We will notify you of
          material changes by posting the updated Terms on this page with a
          revised &quot;Last updated&quot; date. Your continued use of the
          Service after changes constitutes acceptance of the revised Terms.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          12. Contact
        </h2>
        <p>
          For questions about these Terms, contact us at{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            legal@motivefaith.app
          </span>
          .
        </p>
      </section>
    </div>
  );
}
