import type { CampaignRow, Config } from "../api";
import { Icon } from "../ui/icons";
import { PageHead } from "../ui/Schedule";

const DOORS = [
  { href: "#design", title: "Fund depth", line: "Design a campaign from one sentence." },
  { href: "#makers", title: "Make markets", line: "See what quoting pays, run the bot." },
  { href: "#verify", title: "Check payouts", line: "Recompute every epoch, or look up a claim." },
];

export function Start({ campaign, config }: { campaign: CampaignRow | null; config: Config | null }) {
  void campaign; void config;
  return (
    <>
      <section className="page-head">
        <PageHead wp="0" title="Start" />
        <h1 className="thesis">Sponsors pay for order-book depth on Monad. Anyone can recompute who earned it.</h1>
        <p>Rewards go to makers who keep a Kuru book tight on both sides. Your browser can check every payout against public order logs.</p>
      </section>
      <nav className="doors" aria-label="Where to go next">
        {DOORS.map((d) => (
          <a key={d.href} href={d.href} className="door">
            <span className="door-title">{d.title}<Icon.arrow /></span>
            <span className="door-line">{d.line}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
