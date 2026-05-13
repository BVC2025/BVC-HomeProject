import { useState } from "react";
import axios from "axios";

function Login() {

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const handleLogin = async () => {

    try {

      const response = await axios.post(
        "http://127.0.0.1:8000/login",
        {
          EMAIL: email,
          PASSWORD: password
        }
      );

      localStorage.setItem(
        "token",
        response.data.access_token
      );

      alert("Login Success");

    } catch (error) {

      console.log(error);

      alert("Login Failed");
    }
  };

  return (

    <div className="login-page">

      <div className="login-box">

        <h1>Vending ERP</h1>

        <p>Manufacturing Management System</p>

        <input
          type="email"
          placeholder="Enter Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          placeholder="Enter Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button onClick={handleLogin}>
          Login
        </button>

      </div>

    </div>
  );
}

export default Login;