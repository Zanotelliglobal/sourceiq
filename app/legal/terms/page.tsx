import type { Metadata } from "next";
import LegalLayout, { LegalSection, LegalList } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service — SourceIQ",
  description: "The terms governing use of the SourceIQ platform.",
};

export default function TermsOfService() {
  const mailto = (addr: string) => <a href={`mailto:${addr}`}>{addr}</a>;

  return (
    <LegalLayout
      title="Terms of Service"
      intro={`These Terms of Service (“Terms”) govern your access to and use of ${COMPANY.product} (the “Service”), operated by ${COMPANY.legalName}. By creating an account or using the Service, you agree to these Terms. If you are entering into these Terms on behalf of an organisation, you represent that you are authorised to bind that organisation.`}
    >
      <LegalSection heading="1. The Service">
        <p>
          {COMPANY.product} is an AI-assisted supplier discovery and procurement-intelligence platform.
          It uses automated agents to identify potential suppliers, score them, and — at your
          direction — conduct outreach on your behalf. The Service is provided on a subscription basis.
        </p>
      </LegalSection>

      <LegalSection heading="2. Accounts">
        <p>
          You must provide accurate information when creating an account and keep your credentials
          secure. You are responsible for all activity under your account. You must be at least 18
          years old and use the Service for business purposes.
        </p>
      </LegalSection>

      <LegalSection heading="3. Subscriptions, billing & trials">
        <LegalList
          items={[
            "Paid plans are billed in advance on a recurring basis through our payment processor, Stripe.",
            "Free trials, where offered, convert to a paid subscription unless cancelled before the trial ends.",
            "Fees are exclusive of applicable taxes unless stated otherwise.",
            "You can cancel at any time; cancellation takes effect at the end of the current billing period.",
            "Except where required by law, fees already paid are non-refundable.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            "Use the Service to send spam, unlawful, deceptive, or harassing communications.",
            "Upload or process data you do not have the right to use.",
            "Attempt to reverse-engineer, disrupt, or gain unauthorised access to the Service.",
            "Use the Service to violate any applicable law, including data-protection and anti-spam laws.",
            "Resell or provide the Service to third parties except as expressly permitted.",
          ]}
        />
        <p>
          You are responsible for ensuring that your outreach campaigns comply with applicable
          marketing and data-protection laws in the jurisdictions you target.
        </p>
      </LegalSection>

      <LegalSection heading="5. AI-generated content">
        <p>
          The Service uses AI models to generate supplier assessments, scores, draft communications,
          and other outputs. These outputs may be inaccurate or incomplete and are provided as
          decision-support only. You are responsible for reviewing outputs before relying on or acting
          on them. The Service does not provide legal, financial, or investment advice.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your data">
        <p>
          You retain all rights to the data you submit. You grant us a limited licence to process it
          solely to provide the Service. Our handling of personal data is described in our{" "}
          <a href="/legal/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection heading="7. Intellectual property">
        <p>
          The Service, including its software, design, and branding, is owned by {COMPANY.legalName}
          and protected by intellectual-property laws. These Terms grant you a non-exclusive,
          non-transferable right to use the Service during your subscription.
        </p>
      </LegalSection>

      <LegalSection heading="8. Availability">
        <p>
          We aim to keep the Service available but do not guarantee uninterrupted operation. We may
          modify, suspend, or discontinue features, and perform maintenance, from time to time.
        </p>
      </LegalSection>

      <LegalSection heading="9. Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties
          of any kind, whether express or implied, including fitness for a particular purpose and
          non-infringement, to the maximum extent permitted by law.
        </p>
      </LegalSection>

      <LegalSection heading="10. Limitation of liability">
        <p>
          To the maximum extent permitted by law, {COMPANY.legalName} shall not be liable for any
          indirect, incidental, or consequential damages, or for lost profits or data. Our total
          aggregate liability arising out of or relating to the Service shall not exceed the amounts
          you paid to us in the twelve months preceding the event giving rise to the claim. Nothing in
          these Terms limits liability that cannot be limited under applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="11. Termination">
        <p>
          You may stop using the Service and cancel your subscription at any time. We may suspend or
          terminate your access if you breach these Terms or use the Service in a way that risks harm
          to us, other users, or third parties.
        </p>
      </LegalSection>

      <LegalSection heading="12. Governing law">
        <p>
          These Terms are governed by the laws of Italy, and the courts of Italy shall have
          jurisdiction, without prejudice to any mandatory consumer-protection rights available to you.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will be reflected by the
          &ldquo;Last updated&rdquo; date above and, where appropriate, communicated to you. Continued
          use of the Service after changes take effect constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact">
        <p>Questions about these Terms can be directed to {mailto(COMPANY.contactEmail)}.</p>
      </LegalSection>
    </LegalLayout>
  );
}
