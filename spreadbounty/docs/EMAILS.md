# Spreadbounty email templates

The Metropolis submission itself goes through the portal, not email. These templates are for the conversations around it:

1. **Pilot sponsor outreach.** This is the deck's ask, and what turns "targets" into a customer.
2. **Follow-ups:** no reply, after a call, after a pilot epoch closes, and after a "not now".
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

## 2. Follow-ups

Pick the one that matches what actually happened. Each goes in the same thread as the outreach, so keep the `Re:` subject.

| Situation | Use | When |
|---|---|---|
| No reply | 2a | About 7 days later, once, and only with a new fact |
| You had a call | 2b | Same day |
| Results are ready to fund | 2c | At each funding point, after you've run `sb verify` yourself |
| They said "not now" | 2d | Within a day, then stop |

2b matters most. It's the email the sponsor acts on, and anything vague in it turns into a second call or a stall.

### 2a. No reply

**Subject:** Re: Verifiable depth for [AUSD/USDC] on Kuru, a one-week pilot

Hi [first name],

A short follow-up. [New fact since the first email, e.g. "Our first live epoch on Kuru closed: [N]% two-sided within [15] bps, verified from the RPC: [tx/link]."]

The pilot offer stands: one week, your budget, your distributor, and every payout recomputable before you fund the next epoch. If depth on [AUSD/USDC] isn't a priority right now, a one-line "not now" is genuinely useful too.

[Name]

Without a real new fact, don't send it. A second nudge with no new fact is noise.

### 2b. After a call: the pilot terms

**Subject:** Re: Verifiable depth for [AUSD/USDC] on Kuru, a one-week pilot

Hi [first name],

Thanks for the time today. Here's what we agreed, so we're working from the same terms. Correct anything I got wrong.

**Pilot terms**
- Market: Kuru [AUSD/USDC] (`[market address]`)
- Band: within [15] bps of [1.0000]
- Budget: [$__/day] in [USDC], [hourly] epochs, for [7] days, starting [DATE]
- Scoring: one sample about every minute at a block-hash-chosen block. An order needs 20 blocks of rest to count. One-sided quoting earns a third.
- Distributor: the unmodified 1inch `CumulativeMerkleDrop`, owned by [your wallet / your multisig `0x…`]. [You deploy it / We deploy it and transfer ownership to you in the same run.] You fund and publish once a [day]. Each root carries every earlier epoch's totals, so one transaction covers the whole day, and the most at risk at any time is one day's budget.
- Our fee: [__]% of the campaign budget, [waived for the pilot / invoiced at the end].

**What you check before each funding**
- That `sb verify` passes on the latest epoch file. You or anyone can run it.
- How often the book was two-sided inside the band.
- The depth inside the band.
- The cost per $1,000 of depth.
- How many makers other than us were paid.

**Next steps**
- [Us]: [send the campaign file and the deploy command by DATE]
- [You]: [deploy or confirm the owner address; fund the first day by DATE]

If the numbers aren't worth paying for after the first [day], stop funding. Nothing else needs cancelling.

[Name]

Write only what was actually agreed on the call. Leave anything left open as a question, not a term. If you deploy for them, use `npm run drop -- deploy <campaign.json> --owner 0x…` so ownership moves to them in the same run, and send the transaction hash.

### 2c. Results ready to fund

**Subject:** Re: [AUSD/USDC] pilot, results through epoch [N]

Hi [first name],

Epoch [N] on [AUSD/USDC] closed at block [block]. Its root covers every epoch so far and is ready for you to fund.

| | Epoch [N] | [Before the pilot / Epoch N−1] |
|---|---|---|
| Two-sided inside the band | [__]% of samples | [__]% |
| Average depth inside the band, thinner side | [__] USDC | [__] USDC |
| Paid out of budget | [__] of [__] USDC | [__] of [__] USDC |
| Cost per $1,000 of depth | [__] USDC | [n/a] |
| Makers paid (not us) | [__] ([__]) | [__] ([__]) |
| Largest single maker's share | [__]% | [__]% |

- Epoch file: [link]
- Merkle root: `[0x…]`
- To check it yourself: `npm run sb -- verify [epoch file]`, or the Verify page. Either one refetches Kuru's logs and recomputes every payout.

[One honest sentence on what went wrong or looks weak, e.g. "Only our bot quoted this epoch; no outside maker has shown up yet."]

To fund and publish: `npm run drop -- publish [epoch file] --fund --yes` from the owner wallet. It refuses a root that doesn't recompute from the logs or isn't fully funded.

[Name]

Run `npm run sb -- verify [epoch file]` first. If it doesn't print `VERIFIED`, don't send this; tell them that, and why, instead. Then copy every number from `npm run sb -- report [epoch file]`, never from memory. The report gives every row except "not us": count that yourself by removing your own addresses from the epoch file's payout list. The report compares against the previous epoch only, so for a "before the pilot" column, use the Day-0 read of the empty book and say so.

### 2d. They said "not now"

**Subject:** Re: Verifiable depth for [AUSD/USDC] on Kuru, a one-week pilot

Hi [first name],

Thanks for the straight answer. One question so I don't waste your time later: is it [the timing / the budget / that depth on this book isn't the problem / something else]?

If it's useful, I'll send you one line when a live epoch on Kuru has closed and verified, and nothing more unless you write back.

[Name]

After this one, stop. Only write again with the result you promised, and only once.

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
- [ ] Results (2c): the epoch printed `VERIFIED`, and every number came from `sb report`
- [ ] Terms (2b): only what was agreed; anything still open is phrased as a question
- [ ] Repo, FAQ and video links open while logged out
- [ ] One recipient per email, with no CC chains to people at other organizations
- [ ] Nothing that reads as a partnership or endorsement that doesn't exist
