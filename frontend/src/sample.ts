export const sample = `[00:00] Maya: Let's review the Atlas beta launch. We need a decision on scope, owners, and the launch gate.
[00:35] Leo: The new onboarding flow is ready. The analytics dashboard still has a data freshness bug.
[01:10] Priya: I propose delaying the whole launch until analytics is fixed.
[01:45] Maya: Let's consider shipping onboarding first. We have ten pilot customers waiting.
[02:20] Leo: We can keep analytics behind a feature flag. The onboarding flow passed all acceptance tests.
[03:05] Priya: That works if we clearly tell pilot customers analytics is not included yet.
[03:40] Maya: Agreed. The decision is to launch onboarding to the ten pilot customers on November 12, with analytics disabled behind a feature flag. We are not delaying the whole launch.
[04:15] Leo: I will configure the analytics feature flag and verify it in staging by November 8.
[05:00] Priya: I will write the pilot customer announcement by November 9. It will explain that analytics is coming later.
[05:45] Maya: Before launch, we need a security review. Sam, can you own that?
[06:10] Sam: Yes. I will complete the security review by November 10 and report any blockers here.
[07:00] Leo: The data freshness bug may need a queue change. I don't have an estimate yet.
[08:20] Priya: Do we have budget for an additional analytics engineer?
[09:00] Maya: The hiring budget is unresolved. We need finance input before making a commitment.
[10:15] Sam: If the security review finds a critical issue, we stop the launch until it is fixed.
[11:00] Maya: Agreed, no critical security issues is the launch gate. We will review progress on November 11.
[12:10] Priya: What is the success metric for the pilot?
[13:00] Maya: Let's target eight of the ten customers completing onboarding within the first week. This is a proposed metric; we still need product approval.
[14:30] Leo: Understood. Analytics is out of the initial scope, and I own the flag configuration.
[15:00] Maya: Thanks everyone. We'll keep the unresolved hiring budget and proposed success metric for the next review.`;
