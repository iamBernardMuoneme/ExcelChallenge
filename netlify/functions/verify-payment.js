// netlify/functions/verify-payment.js
// Verifies Flutterwave transactions server-side using your secret key.
// The secret key is stored as a Netlify environment variable — never in code.

exports.handler = async function(event) {

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { transaction_id, name, email, phone } = JSON.parse(event.body);

    if (!transaction_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ status: "error", message: "No transaction ID provided" })
      };
    }

    // ── Step 1: Verify transaction with Flutterwave API ──────────────────
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const verifyData = await verifyRes.json();

    // ── Step 2: Confirm amount, currency and status are all correct ───────
    const tx = verifyData.data;
    const isValid =
      verifyData.status === "success" &&
      tx.status === "successful" &&
      tx.amount >= 15000 &&
      tx.currency === "NGN";

    if (!isValid) {
      // Log the failed/suspicious attempt to the sheet
      await logToSheet(name, email, phone, "Paid - Full 30 Days", "Payment Failed / Suspicious");
      return {
        statusCode: 400,
        body: JSON.stringify({ status: "error", message: "Payment verification failed" })
      };
    }

    // ── Step 3: Log confirmed payment to Google Sheet ─────────────────────
    await logToSheet(name, email, phone, "Paid - Full 30 Days", "Payment Verified ✓");

    return {
      statusCode: 200,
      body: JSON.stringify({ status: "success" })
    };

  } catch (err) {
    console.error("Verification error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ status: "error", message: err.toString() })
    };
  }
};


// ── Send data to Google Apps Script (which logs + sends email) ────────────
async function logToSheet(name, email, phone, type, status) {
  const SHEET_URL = "https://script.google.com/macros/s/AKfycbxV8exVnp5kdSl3r-NSWIwugIE7HueVzGqjB-EzMLMOScO1Hw4lCdKLStDb6zBMWaqH/exec";

  const form = new URLSearchParams();
  form.append("name",   name   || "");
  form.append("email",  email  || "");
  form.append("phone",  phone  || "");
  form.append("type",   type   || "");
  form.append("status", status || "");

  await fetch(SHEET_URL, {
    method: "POST",
    body: form
  });
}
