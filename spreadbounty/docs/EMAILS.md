# Spreadbounty email templates

The Metropolis submission itself goes through the portal, not email. These templates are for the conversations around it:

1. **Pilot sponsor outreach.** This is the deck's ask, and what turns "targets" into a customer.
2. **Follow-up** after a week with no reply.
3. **Organizer note.** Use it only if the portal or rules name an email contact for submissions.

Rules for all three:
- Fill every `[bracket]`, and never send one with a bracket left in.
- Don't claim anything the repo can't show.
- Don't call a target a partner.
- Find contacts through the project's official channels. Don't guess addresses.

---

## 1. Pilot sponsor outreach

Send to someone who already spends on depth: a stablecoin issuer (e.g. Agora for AUSD), the Kuru team, or the Monad Foundation's ecosystem or DeFi lead.

**Subject:** Verifiable depth for [AUSD/USDC] on Kuru, a one-week pilot

Hi [first name],

When we checked on October 9, Kuru's [AUSD/USDC] book had no resting orders. Spreadbounty lets a sponsor pay any market maker for keeping that book two-sided inside a band, and lets anyone recompute every payout from Kuru's public logs.

Here's how it works:
- You fund a campaign, for example [$__/day], within [15] bps of [1.0000].
- Makers earn by resting tight bids and asks.
- Each epoch publishes the samples, scores and one Merkle root.
- Makers claim from 1inch's unmodified Merkle distributor, which **you** own and fund one epoch at a time. We never hold funds.

The ask is a one-week pilot on [AUSD/USDC]. Before each epoch is funded, you check:
- how often the book was two-sided inside the band;
- the depth inside the band;
- the cost per $1,000 of depth;
- how many makers other than us showed up.

Status, plainly: the scorer, verifier, maker bot and claim tooling are built and tested (32 tests). [Our first live epoch ran on DATE / The first live epoch is scheduled for DATE.] Code and a one-page FAQ: [repo link] · [FAQ link]

Would [15 minutes next week] work to set the band and budget?

[Name]
[Role], Spreadbounty · [contact]

---

## 2. Follow-up (about 7 days later, once)

**Subject:** Re: Verifiable depth for [AUSD/USDC] on Kuru, a one-week pilot

Hi [first name],

A short follow-up. [New fact since the first email, e.g. "Our first live epoch on Kuru closed: [N]% two-sided within [15] bps, verified from the RPC: [tx/link]."]

The pilot offer stands: one week, your budget, your distributor, and every payout recomputable before you fund the next epoch. If depth on [AUSD/USDC] isn't a priority right now, a one-line "not now" is genuinely useful too.

[Name]

Only send this if there's a real new fact. Without one, don't follow up.

---

## 3. Organizer note (only if the rules ask for email)

**Subject:** Metropolis submission: Spreadbounty (Track 1, Onchain Finance & Trading)

Hi Metropolis team,

We've submitted Spreadbounty through the portal: [portal project link].

- Demo video: [link]
- Write-up: [link]
- Code: [repo link] (built Oct 8–10, with public history)
- Judge FAQ: [link]

[Name], for team [team name] · [contact]

---

## Before sending

- [ ] Every bracket filled; the status line matches what has actually run on mainnet
- [ ] Repo, FAQ and video links open while logged out
- [ ] One recipient per email, with no CC chains to people at other organizations
- [ ] Nothing that reads as a partnership or endorsement that doesn't exist
