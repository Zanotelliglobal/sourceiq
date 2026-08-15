"use client";

import Link from "next/link";
import { UserButton, useUser, useOrganization } from "@clerk/nextjs";
import { User, Building2, Globe, CreditCard, LifeBuoy } from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import TeamSettings from "@/components/TeamSettings";
import NotificationSettings from "@/components/NotificationSettings";
import ReferralCard from "@/components/ReferralCard";

// Central account/settings hub for the app surface. Groups the identity controls
// (Clerk user + org), language preference, and billing/support entry points that
// were previously scattered across the top nav and sidebar.
export default function SettingsPage() {
  const t = useT();
  const { user } = useUser();
  const { organization } = useOrganization();

  return (
    <div className="max-w-screen-md mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("Settings")}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {t("Manage your account, workspace, and preferences.")}
        </p>
      </div>

      <div className="space-y-4">
        {/* Account */}
        <div className="card px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
              <User className="w-4.5 h-4.5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900">{t("Account")}</div>
              <div className="text-xs text-slate-500 truncate">
                {user?.primaryEmailAddress?.emailAddress || user?.fullName || t("Manage your profile and security")}
              </div>
            </div>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>

        {/* Workspace */}
        <div className="card px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4.5 h-4.5 text-slate-500" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900">{t("Workspace")}</div>
            <div className="text-xs text-slate-500 truncate">
              {organization?.name || t("Your personal workspace")}
            </div>
          </div>
        </div>

        {/* Team & seats */}
        <TeamSettings />

        {/* Email notifications */}
        <NotificationSettings />

        {/* Referrals */}
        <ReferralCard />

        {/* Language */}
        <div className="card px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
              <Globe className="w-4.5 h-4.5 text-slate-500" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">{t("Language")}</div>
              <div className="text-xs text-slate-500">{t("Choose your interface language")}</div>
            </div>
          </div>
          <LanguageSwitcher />
        </div>

        {/* Billing */}
        <Link href="/billing" className="card px-5 py-4 flex items-center gap-3 hover:bg-slate-50/60 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-4.5 h-4.5 text-emerald-600" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">{t("Billing & plan")}</div>
            <div className="text-xs text-slate-500">{t("View your subscription, usage, and invoices")}</div>
          </div>
        </Link>

        {/* Support */}
        <a href="mailto:support@sourcegpt.org" className="card px-5 py-4 flex items-center gap-3 hover:bg-slate-50/60 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
            <LifeBuoy className="w-4.5 h-4.5 text-slate-500" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">{t("Support")}</div>
            <div className="text-xs text-slate-500">{t("Get help from our team")}</div>
          </div>
        </a>
      </div>
    </div>
  );
}
