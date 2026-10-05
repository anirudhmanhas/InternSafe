export default function About() {
  return (
    <>
      <h1>About InternSafe</h1>
      <h2>The problem</h2>
      <p>Students lose money and personal data to fake internship offers: registration fees, "guaranteed selection", HR who only chat on Telegram. Today they guess or ask friends in WhatsApp groups.</p>
      <h2>How the check works</h2>
      <p>InternSafe applies a fixed list of red-flag rules to the offer text. Each rule has a weight, and the weights add up to a score from 0 to 100. The same offer always gets the same result, and every flag comes with a reason. It understands English and Hinglish.</p>
      <h2>Privacy</h2>
      <p>The text you paste is never saved. We keep only counters, and reports are saved after removing emails, phone numbers and long numbers.</p>
      <h2>AI tools used</h2>
      <p>This project was built with AI assistance, as the hackathon rules allow.</p>
    </>
  );
}
