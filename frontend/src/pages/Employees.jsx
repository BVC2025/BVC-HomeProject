import { useEffect, useState } from "react";

import API from "../services/api";

function Employees() {

  const [employees, setEmployees] = useState([]);

  const [name, setName] = useState("");

  const [email, setEmail] = useState("");

  const fetchEmployees = async () => {

    try {

      const response = await API.get("/employees");

      setEmployees(response.data);

    } catch (error) {

      console.log(error);
    }
  };

  useEffect(() => {

    fetchEmployees();

  }, []);

  const createEmployee = async () => {

    try {

      await API.post("/create-employee", {

        NAME: name,
        EMAIL: email,
        PASSWORD: "1234",
        ROLE_ID: 1,
        VENDOR_ID: 1
      });

      alert("Employee Created");

      fetchEmployees();

      setName("");
      setEmail("");

    } catch (error) {

      console.log(error);

      alert("Error creating employee");
    }
  };

  return (

    <div>

      <h1>Employees</h1>

      <div className="employee-form">

        <input
          type="text"
          placeholder="Employee Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <input
          type="email"
          placeholder="Employee Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button onClick={createEmployee}>
          Add Employee
        </button>

      </div>

      <table className="employee-table">

        <thead>

          <tr>

            <th>ID</th>

            <th>Name</th>

            <th>Email</th>

            <th>Status</th>

            <th>Role ID</th>

            <th>Vendor ID</th>

          </tr>

        </thead>

        <tbody>

          {
            employees.map((emp) => (

              <tr key={emp.ID}>

                <td>{emp.ID}</td>

                <td>{emp.NAME}</td>

                <td>{emp.EMAIL}</td>

                <td>{emp.STATUS}</td>

                <td>{emp.ROLE_ID}</td>

                <td>{emp.VENDOR_ID}</td>

              </tr>
            ))
          }

        </tbody>

      </table>

    </div>
  );
}

export default Employees;

// import { useEffect, useState } from "react";

// import API from "../services/api";

// function Employees() {

//   const [employees, setEmployees] = useState([]);

//   const fetchEmployees = async () => {

//     try {

//       const response = await API.get("/employees");

//       setEmployees(response.data);

//     } catch (error) {

//       console.log(error);
//     }
//   };

//   useEffect(() => {

//     fetchEmployees();

//   }, []);

//   return (

//     <div>

//       <h1>Employees</h1>

//       <table className="employee-table">

//   <thead>

//     <tr>

//       <th>ID</th>

//       <th>Name</th>

//       <th>Email</th>

//       <th>Status</th>

//       <th>Role ID</th>

//       <th>Vendor ID</th>

//     </tr>

//   </thead>

//   <tbody>

//     {
//       employees.map((emp) => (

//         <tr key={emp.ID}>

//           <td>{emp.ID}</td>

//           <td>{emp.NAME}</td>

//           <td>{emp.EMAIL}</td>

//           <td>{emp.STATUS}</td>

//           <td>{emp.ROLE_ID}</td>

//           <td>{emp.VENDOR_ID}</td>

//         </tr>
//       ))
//     }

//   </tbody>

// </table>
//     </div>
//   );
// }

// export default Employees;