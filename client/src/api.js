export async function checkEmail(email) {
  const res = await fetch('http://localhost:4000/api/auth/check-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return res.json();
}

export async function register(name, email) {
  const res = await fetch('http://localhost:4000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email })
  });
  
  if (!res.ok) {
    const error = new Error(res.statusText);
    error.status = res.status;
    throw error;
  }
  
  return res.json();
}
