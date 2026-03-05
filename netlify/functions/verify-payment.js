// netlify/functions/verify-payment.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function(event) {

  // Handle preflight CORS request
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  try {
    console.log("verify-payment called");
    console.log("Raw body:", event.body);

    const payload = JSON.parse(event.body);
    console.log("Parsed payload:", JSON.stringify(payload));

    const { name, email, phone } = payload;

    // Flutterwave can return transaction ID under different field names
    const transaction_id = payload.transaction_id || payload.id || payload.flw_ref;
    console.log("Transaction ID:", transaction_id);

    if (!transaction_id) {
      console.log("No transaction ID found in payload");
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", message: "No transaction ID found" })
      };
    }

    // Check secret key is available
    if (!process.env.FLW_SECRET_KEY) {
      console.log("ERROR: FLW_SECRET_KEY environment variable is not set");
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", message: "Server configuration error" })
      };
    }

    // ── Verify with Flutterwave API ───────────────────────────────────────
    console.log("Calling Flutterwave verify API...");
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
    console.log("Flutterwave response:", JSON.stringify(verifyData));

    const tx = verifyData.data;

    if (!tx) {
      console.log("No transaction data in Flutterwave response");
      await logToSheet(name, email, phone, "Paid - Full 30 Days", "Verification Failed - No Data");
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", message: "Could not retrieve transaction" })
      };
    }

    console.log("TX status:", tx.status, "| Amount:", tx.amount, "| Currency:", tx.currency);

    const isValid =
      verifyData.status === "success" &&
      tx.status === "successful" &&
      tx.amount >= 15000 &&
      tx.currency === "NGN";

    if (!isValid) {
      console.log("Payment validation failed");
      await logToSheet(name, email, phone, "Paid - Full 30 Days", "Payment Failed / Invalid");
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", message: "Payment verification failed" })
      };
    }

    // ── All good — log to sheet and send email ────────────────────────────
    console.log("Payment verified successfully, logging to sheet...");
    await logToSheet(name, email, phone, "Paid - Full 30 Days", "Payment Verified");
    console.log("Done!");

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "success" })
    };

  } catch (err) {
    console.error("Verification error:", err.toString());
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", message: err.toString() })
    };
  }
};


// ── Log to Google Apps Script (handles sheet + email) ─────────────────────
async function logToSheet(name, email, phone, type, status) {
  const SHEET_URL = "https://script.google.com/macros/s/AKfycbxV8exVnp5kdSl3r-NSWIwugIE7HueVzGqjB-EzMLMOScO1Hw4lCdKLStDb6zBMWaqH/exec";

  const form = new URLSearchParams();
  form.append("name",   name   || "");
  form.append("email",  email  || "");
  form.append("phone",  phone  || "");
  form.append("type",   type   || "");
  form.append("status", status || "");

  try {
    const res = await fetch(SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    console.log("Sheet log response status:", res.status);
  } catch (err) {
    console.error("Sheet log failed:", err.toString());
  }
}
