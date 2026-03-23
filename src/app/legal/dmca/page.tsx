import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DMCA Policy | MotiveFaith",
};

export default function DmcaPage() {
  return (
    <div className="space-y-8 text-[var(--color-text-primary)]">
      <header>
        <h1 className="font-display text-3xl font-bold mb-2">DMCA Policy</h1>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          Last updated: February 23, 2026
        </p>
      </header>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <p>
          MotiveFaith respects the intellectual property rights of others and expects
          users to do the same. In accordance with the Digital Millennium
          Copyright Act of 1998 (17 U.S.C. &sect; 512), we will respond
          expeditiously to claims of copyright infringement committed using the
          Service.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          Filing a Takedown Notice
        </h2>
        <p>
          If you believe that content on MotiveFaith infringes your copyright, please
          send a written notification to our designated DMCA agent containing:
        </p>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            A physical or electronic signature of a person authorized to act on
            behalf of the copyright owner
          </li>
          <li>
            Identification of the copyrighted work claimed to have been infringed
          </li>
          <li>
            Identification of the material that is claimed to be infringing and
            information reasonably sufficient to permit us to locate the material
            (e.g., a URL or description)
          </li>
          <li>
            Your contact information, including address, telephone number, and
            email address
          </li>
          <li>
            A statement that you have a good faith belief that use of the
            material is not authorized by the copyright owner, its agent, or the
            law
          </li>
          <li>
            A statement that the information in the notification is accurate, and
            under penalty of perjury, that you are authorized to act on behalf of
            the copyright owner
          </li>
        </ol>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          Designated DMCA Agent
        </h2>
        <p>
          Send DMCA takedown notices to:
        </p>
        <div className="bg-[var(--color-bg-secondary)] rounded-md p-4 text-[var(--color-text-primary)]">
          <p>DMCA Agent</p>
          <p>MotiveFaith</p>
          <p>
            Email:{" "}
            <span className="font-medium">dmca@motivefaith.app</span>
          </p>
        </div>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          Counter-Notification
        </h2>
        <p>
          If you believe your content was removed in error, you may file a
          counter-notification containing:
        </p>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Your physical or electronic signature</li>
          <li>
            Identification of the material that was removed and the location
            where it appeared before removal
          </li>
          <li>
            A statement under penalty of perjury that you have a good faith
            belief the material was removed as a result of mistake or
            misidentification
          </li>
          <li>
            Your name, address, and telephone number, and a statement that you
            consent to the jurisdiction of the federal court in your district
          </li>
        </ol>
        <p>
          Upon receiving a valid counter-notification, we will forward it to the
          original complainant. If the complainant does not file a court action
          within 10 business days, we may restore the removed content.
        </p>
      </section>

      <section className="space-y-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <h2 className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          Repeat Infringer Policy
        </h2>
        <p>
          MotiveFaith will terminate accounts of users who are repeat copyright
          infringers. We track DMCA notices and counter-notices, and accounts
          that receive multiple valid takedown notices may be permanently
          suspended.
        </p>
      </section>
    </div>
  );
}
