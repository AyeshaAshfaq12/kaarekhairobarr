// Seeded as NdaVersion 1 (§12). Admin can publish new versions in Settings.
export const NDA_V1_TITLE = 'Member Confidentiality and Conduct Agreement'

export const NDA_V1_BODY = `# Kaare Khair o Barr — Member Confidentiality and Conduct Agreement

This agreement is between Kaare Khair o Barr ("KKB") and the member signing below ("I").
I am joining KKB voluntarily, without any salary or payment.

## 1. Confidential information
Confidential information means anything I learn through KKB that is not public, including:
(a) names, contact details, CNICs, medical, financial or family details of beneficiaries;
(b) names, contact details and donation amounts of donors;
(c) personal details of other members;
(d) KKB's internal plans, finances, accounts, reports and discussions;
(e) anything in the KKB portal.

## 2. What I agree to
1. I will use confidential information only for KKB's work.
2. I will not share it with anyone outside KKB, or with KKB members who do not need it.
3. I will not post, forward or screenshot beneficiary details, photos or documents on any platform (including WhatsApp, Instagram and Facebook) without written approval from a KKB admin.
4. I will protect the dignity of beneficiaries. I will never share images or stories that could identify or embarrass them without their consent and admin approval.
5. I will keep my portal password private and log out on shared devices.
6. I will report any leak or misuse I become aware of to a KKB admin immediately.

## 3. Money and donations
1. I will only direct donors to KKB's official payment accounts announced by KKB admins.
2. I will never collect donations into my personal account unless an admin approves it in writing.
3. Any cash I receive for KKB, I will record in the portal and hand over within 3 days.
4. I will record donations and expenses honestly, with proof.
5. I will not use KKB's name to raise money for any other purpose.

## 4. Representing KKB
I will not speak to the media or make public statements on behalf of KKB without approval, and I will behave respectfully with members, donors and beneficiaries.

## 5. Leaving KKB
When I leave, I will delete or return KKB information in my possession, including contacts saved for KKB work and files, and exit KKB groups if asked.
My duties under sections 1–3 continue after I leave. They continue indefinitely for beneficiary information and for two years for all other information.

## 6. Breach
If I break this agreement, KKB may suspend or remove my membership and take any further action available under the laws of Pakistan.

## 7. Acknowledgement
I have read and understood this agreement and I sign it of my own free will. Typing my full name below is my electronic signature.`

// Default onboarding checklist (§5.4).
export const DEFAULT_ONBOARDING_ITEMS = [
  { title: 'Complete your profile and photo', completedBy: 'MEMBER', autoKey: null },
  { title: 'Read the KKB handbook', description: 'The link is in Settings.', completedBy: 'MEMBER', autoKey: null },
  { title: 'Join your team WhatsApp groups', completedBy: 'MEMBER', autoKey: null },
  { title: 'Have an intro call with your lead', description: 'Your lead ticks this.', completedBy: 'LEAD', autoKey: 'LEAD_INTRO_CALL' },
  { title: 'Attend an orientation session', completedBy: 'MEMBER', autoKey: null },
  { title: 'Log your first outreach', description: 'Ticks itself when you log an outreach.', completedBy: 'SYSTEM', autoKey: 'FIRST_OUTREACH' },
] as const
