import type { Metadata } from "next";
import LegalLayout, { LegalSection, LegalList } from "@/components/legal/LegalLayout";
import { COMPANY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "CCPA Policy — SourceGPT",
  description: "Your California privacy rights under the CCPA/CPRA and how SourceGPT honors them.",
};

export default function CcpaPolicy() {
  const mailto = (addr: string) => <a href={`mailto:${addr}`}>{addr}</a>;

  return (
    <LegalLayout
      title="CCPA Policy"
      intro={`This notice supplements ${COMPANY.legalName}'s Privacy Policy for California residents. It describes the categories of personal information ${COMPANY.product} collects, the rights California residents have under the California Consumer Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA), and how to exercise those rights. This notice reflects our actual data practices — it is not, and does not claim to be, a legal opinion or a document reviewed by legal counsel.`}
    >
      <LegalSection heading="1. Categories of personal information we collect">
        <p>
          Depending on how you use the Service, we may collect the following categories of personal
          information, consistent with the categories described in our{" "}
          <a href="/legal/privacy">Privacy Policy</a>:
        </p>
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

      <LegalSection heading="2. Your CCPA rights">
        <p>If you are a California resident, you have the following rights with respect to your personal information:</p>
        <LegalList
          items={[
            "Right to know what personal information is collected, used, and disclosed.",
            "Right to delete personal information, subject to certain exceptions (e.g. information we must retain for legal, tax, or accounting obligations).",
            "Right to opt out of the sale or sharing of personal information — SourceGPT does not sell or share personal data with third parties for cross-context behavioral advertising.",
            "Right to correct inaccurate personal information we maintain about you.",
            "Right to non-discrimination for exercising any of your CCPA rights — we will not deny you the Service, charge you a different price, or provide a different level of quality because you exercised a privacy right.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. How to exercise your rights">
        <p>
          To exercise any of the rights above, contact us at {mailto(COMPANY.contactEmail)}. To
          protect your information, we will take reasonable steps to verify that the request is being
          made by you (or your authorised agent) before honoring it — typically by confirming details
          associated with your account. We will respond within the timeframe required by the CCPA/CPRA.
        </p>
      </LegalSection>

      <LegalSection heading="4. Notice at collection">
        <p>
          At the time you create an account, we collect the account data described in Section 1 above
          (name, work email, organisation name) for the business purpose of providing the Service and
          administering your subscription. As you use the Service, we collect sourcing, communications,
          and usage data for the business purpose of operating the AI-driven discovery and outreach
          features you direct us to run on your behalf.
        </p>
      </LegalSection>

      <LegalSection heading="5. Financial incentives">
        <p>
          SourceGPT does not offer any financial incentive, discount, or other benefit in exchange for
          the collection, sale, or retention of your personal information.
        </p>
      </LegalSection>

      <LegalSection heading="6. Contact">
        <p>
          Questions about this notice or our data practices can be directed to {mailto(COMPANY.contactEmail)}.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
