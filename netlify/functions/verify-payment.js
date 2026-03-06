// netlify/functions/verify-payment.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function(event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  try {
    console.log("verify-payment called");
    const payload = JSON.parse(event.body);
    console.log("Payload:", JSON.stringify(payload));

    const { name, email, phone } = payload;

    // Get both possible identifiers from Flutterwave callback
    const transaction_id = payload.transaction_id || payload.id;
    const tx_ref = payload.tx_ref || payload.txRef;

    console.log("transaction_id:", transaction_id, "| tx_ref:", tx_ref);

    if (!transaction_id && !tx_ref) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", message: "No transaction identifier found" })
      };
    }

    let verifyData;

    // Try numeric transaction_id first
    if (transaction_id && String(transaction_id).match(/^\d+$/)) {
      console.log("Verifying by transaction_id:", transaction_id);
      const res = await fetch(
        `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );
      verifyData = await res.json();
      console.log("By ID response:", JSON.stringify(verifyData));
    }

    // If that failed or no numeric ID, try by tx_ref
    if (!verifyData?.data && tx_ref) {
      console.log("Verifying by tx_ref:", tx_ref);
      const res = await fetch(
        `https://api.flutterwave.com/v3/transactions?tx_ref=${tx_ref}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );
      const listData = await res.json();
      console.log("By tx_ref response:", JSON.stringify(listData));
      // tx_ref query returns a list — get the first match
      if (listData?.data?.length > 0) {
        verifyData = { status: "success", data: listData.data[0] };
      }
    }

    const tx = verifyData?.data;

    if (!tx) {
      console.log("No transaction data found");
      await logToSheet(name, email, phone, "Paid - Full 30 Days", "Verification Failed - Not Found");
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", message: "Could not retrieve transaction" })
      };
    }

    console.log("TX status:", tx.status, "| Amount:", tx.amount, "| Currency:", tx.currency);

    const isValidAmount = tx.amount >= 15000 && tx.currency === "NGN";
    const isSuccessful = tx.status === "successful";
    const isPending = tx.status === "pending" || tx.status === "pending verification";

    if (!isValidAmount || (!isSuccessful && !isPending)) {
      console.log("Validation failed");
      await logToSheet(name, email, phone, "Paid - Full 30 Days", `Payment Failed - Status: ${tx.status}`);
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", message: "Payment validation failed" })
      };
    }

    const logStatus = isSuccessful ? "Payment Verified" : "Payment Pending - Bank Transfer";
    await logToSheet(name, email, phone, "Paid - Full 30 Days", logStatus);
    console.log("Success! Logged as:", logStatus);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "success" })
    };

  } catch (err) {
    console.error("Error:", err.toString());
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", message: err.toString() })
    };
  }
};


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
    console.log("Sheet log status:", res.status);
  } catch (err) {
    console.error("Sheet log failed:", err.toString());
  }
}
