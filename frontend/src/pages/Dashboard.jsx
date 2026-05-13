import { Link, Routes, Route } from "react-router-dom";

import Employees from "./Employees";
import Projects from "./Projects";
import Tasks from "./Tasks";
import Inventory from "./Inventory";

function Dashboard() {

  return (

    <div className="dashboard">

      <div className="sidebar">

        <h2>Vending ERP</h2>

        <ul>

          <li>
            <Link to="/">
              Dashboard
            </Link>
          </li>

          <li>
            <Link to="/employees">
              Employees
            </Link>
          </li>

          <li>
            <Link to="/projects">
              Projects
            </Link>
          </li>

          <li>
            <Link to="/tasks">
              Tasks
            </Link>
          </li>

          <li>
            <Link to="/inventory">
              Inventory
            </Link>
          </li>

        </ul>

      </div>

      <div className="main-content">

        <Routes>

          <Route
            path="/"
            element={
              <>
                <h1>Dashboard</h1>

                <div className="cards">

                  <div className="card">
                    <h3>Total Employees</h3>
                    <p>15</p>
                  </div>

                  <div className="card">
                    <h3>Total Projects</h3>
                    <p>8</p>
                  </div>

                  <div className="card">
                    <h3>Pending Tasks</h3>
                    <p>24</p>
                  </div>

                  <div className="card">
                    <h3>Inventory Items</h3>
                    <p>42</p>
                  </div>

                </div>
              </>
            }
          />

          <Route
            path="/employees"
            element={<Employees />}
          />

          <Route
            path="/projects"
            element={<Projects />}
          />

          <Route
            path="/tasks"
            element={<Tasks />}
          />

          <Route
            path="/inventory"
            element={<Inventory />}
          />

        </Routes>

      </div>

    </div>
  );
}

export default Dashboard;