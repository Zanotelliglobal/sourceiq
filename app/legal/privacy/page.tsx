import type { Metadata } from "next";
import LegalLayout, { LegalSection, LegalList } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — SourceIQ",
  description: "How SourceIQ collects, uses, and protects personal data.",
};

export default function PrivacyPolicy() {
  const mailto = (addr: string) => <a href={`mailto:${addr}`}>{addr}</a>;

  return (
    <LegalLayout
      title="Privacy Policy"
      intro={`This Privacy Policy explains how ${COMPANY.legalName}, operator of ${COMPANY.product} (the “Service”), collects, uses, discloses, and safeguards personal data. We act as a data controller for account and billing data, and as a data processor for the sourcing data our customers process through the Service. We comply with the EU General Data Protection Regulation (GDPR) and applicable national law.`}
    >
      <LegalSection heading="1. Who we are">
        <p>
          The Service is operated by <strong>{COMPANY.legalName}</strong>{" "}
          (“we”, “us”, “our”). You can reach us at {mailto(COMPANY.contactEmail)}. For privacy-specific
          requests, contact {mailto(COMPANY.privacyEmail)}.
          {COMPANY.postalAddress ? (
            <>
              {" "}Our registered address is <strong>{COMPANY.postalAddress}</strong>.
            </>
          ) : null}
        </p>
      </LegalSection>

      <LegalSection heading="2. Data we collect">
        <p>Depending on how you use the Service, we may collect:</p>
        <LegalList
          items={[
            <><strong>Account data</strong> — name, work email, organisation name, and authentication identifiers, handled through our identity provider (Clerk).</>,
            <><strong>Billing data</strong> — subscription status and payment metadata. Card details are handled directly by Stripe; we never see or store full card numbers.</>,
            <><strong>Sourcing data</strong> — the sourcing briefs, requirements, and supplier information you create or that our AI agents discover, including supplier names, countries, websites, and business contact details.</>,
            <><strong>Communications data</strong> — the content of Requests for Information (RFIs) sent through the Service and supplier replies received, processed to advance your sourcing funnel.</>,
            <><strong>Usage &amp; technical data</strong> — log data, approximate token/cost usage, and standard server logs generated when you use the Service.</>,
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. How we use data">
        <LegalList
          items={[
            "To provide, operate, and secure the Service and your account.",
            "To run AI-driven supplier discovery, scoring, and outreach on your behalf.",
            "To send and receive RFI correspondence with suppliers you target.",
            "To process subscriptions and payments.",
            "To communicate with you about your account, support requests, and service changes.",
            "To detect, prevent, and investigate abuse, fraud, or security incidents.",
            "To comply with legal obligations.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. Legal bases (GDPR)">
        <p>We process personal data on the following bases:</p>
        <LegalList
          items={[
            <><strong>Contract</strong> — to deliver the Service you have subscribed to.</>,
            <><strong>Legitimate interests</strong> — to operate, secure, and improve the Service, and to conduct B2B supplier outreach on behalf of our customers, balanced against the rights of the individuals concerned.</>,
            <><strong>Legal obligation</strong> — for tax, accounting, and compliance requirements.</>,
            <><strong>Consent</strong> — where specifically requested; you may withdraw consent at any time.</>,
          ]}
        />
      </LegalSection>

      <LegalSection heading="5. Supplier outreach & recipients">
        <p>
          When you run an outreach campaign, the Service sends business emails to the professional
          contact addresses of the suppliers you target. Every message identifies the purpose of the
          contact and includes a one-click opt-out. If a supplier opts out, we suppress their address
          and do not contact them again. Suppliers may exercise their data-protection rights by
          contacting us at {mailto(COMPANY.privacyEmail)}.
        </p>
      </LegalSection>

      <LegalSection heading="6. Sub-processors & sharing">
        <p>
          We share data with trusted service providers who process it on our behalf under appropriate
          data-processing terms:
        </p>
        <LegalList
          items={[
            <><strong>Clerk</strong> — authentication and user management.</>,
            <><strong>Stripe</strong> — payment processing and subscription billing.</>,
            <><strong>Resend</strong> — outbound and inbound email delivery.</>,
            <><strong>Anthropic</strong> — the AI models that power discovery, scoring, and drafting. Data sent to the model is used to generate responses and is not used to train models.</>,
            <><strong>Neon</strong> — managed database hosting.</>,
            <><strong>Vercel</strong> — application hosting and infrastructure.</>,
          ]}
        />
        <p>We do not sell personal data.</p>
      </LegalSection>

      <LegalSection heading="7. International transfers">
        <p>
          Some sub-processors may process data outside the European Economic Area. Where this occurs,
          we rely on appropriate safeguards such as the European Commission&apos;s Standard Contractual
          Clauses or an adequacy decision.
        </p>
      </LegalSection>

      <LegalSection heading="8. Retention">
        <p>
          We keep personal data only as long as necessary for the purposes described above, for the
          life of your account, and thereafter as required to meet legal, tax, and accounting
          obligations. You can request deletion of your account data at any time.
        </p>
      </LegalSection>

      <LegalSection heading="9. Your rights">
        <p>Subject to applicable law, you have the right to:</p>
        <LegalList
          items={[
            "Access the personal data we hold about you.",
            "Request correction of inaccurate data.",
            "Request erasure of your data.",
            "Restrict or object to certain processing.",
            "Data portability.",
            "Lodge a complaint with your supervisory authority (in Italy, the Garante per la protezione dei dati personali).",
          ]}
        />
        <p>To exercise any of these rights, contact {mailto(COMPANY.privacyEmail)}.</p>
      </LegalSection>

      <LegalSection heading="10. Security">
        <p>
          We use industry-standard technical and organisational measures — encryption in transit,
          access controls, and reputable infrastructure providers — to protect personal data. No
          method of transmission or storage is completely secure, and we cannot guarantee absolute
          security.
        </p>
      </LegalSection>

      <LegalSection heading="11. Cookies">
        <p>
          The Service uses only cookies strictly necessary for authentication and session management.
          We do not use advertising or third-party tracking cookies.
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will be reflected by the
          &ldquo;Last updated&rdquo; date above and, where appropriate, communicated to you directly.
        </p>
      </LegalSection>

      <LegalSection heading="13. Contact">
        <p>
          Questions about this policy or our data practices can be directed to{" "}
          {mailto(COMPANY.privacyEmail)}.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
