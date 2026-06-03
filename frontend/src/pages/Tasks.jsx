import { useEffect, useState } from "react";

import API from "../services/api";

function Tasks() {

  const [tasks, setTasks] = useState([]);

  const [projects, setProjects] = useState([]);

  const [employees, setEmployees] = useState([]);

  const [taskName, setTaskName] = useState("");

  const [description, setDescription] = useState("");

  const [projectId, setProjectId] = useState("");

  const [assignedTo, setAssignedTo] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const fetchTasks = async () => {

    try {

      const response = await API.get("/tasks");

      setTasks(response.data);

    } catch (error) {

      console.log(error);
    }
  };

  const fetchProjects = async () => {

    try {

      const response = await API.get("/projects");

      setProjects(response.data);

    } catch (error) {

      console.log(error);
    }
  };

  const fetchEmployees = async () => {

    try {

      const response = await API.get("/employees");

      setEmployees(response.data);

    } catch (error) {

      console.log(error);
    }
  };

  useEffect(() => {

    fetchTasks();

    fetchProjects();

    fetchEmployees();

  }, []);

  const createTask = async () => {

    if (!taskName.trim()) {

      alert("Please enter a task name");

      return;
    }

    if (!projectId) {

      alert("Please select a project");

      return;
    }

    if (!assignedTo) {

      alert("Please select an employee to assign");

      return;
    }

    setSubmitting(true);

    try {

      await API.post("/create-task", {

        TASK_NAME: taskName.trim(),

        DESCRIPTION: description,

        STATUS: "PENDING",

        PRIORITY: "MEDIUM",

        PROJECT_ID: Number(projectId),

        ASSIGNED_TO: assignedTo,

        VENDOR_ID: 1
      });

      alert("Task Created");

      fetchTasks();

      setTaskName("");

      setDescription("");

      setProjectId("");

      setAssignedTo("");

    } catch (error) {

      console.log(error);

      const detail =
        error?.response?.data?.detail ||
        error?.message ||
        "Error creating task";

      alert(detail);

    } finally {

      setSubmitting(false);
    }
  };

  const startTask = async (taskId) => {

    try {

      await API.put(`/start-task/${taskId}`);

      fetchTasks();

    } catch (error) {

      console.log(error);

      alert("Error starting task");
    }
  };

  const completeTask = async (taskId) => {

    try {

      await API.put(`/complete-task/${taskId}`);

      fetchTasks();

    } catch (error) {

      console.log(error);

      alert("Error completing task");
    }
  };

  const holdTask = async (taskId) => {

    try {

      await API.put(`/hold-task/${taskId}`);

      fetchTasks();

    } catch (error) {

      console.log(error);

      alert("Error holding task");
    }
  };

  return (

    <div>

      <h1>Tasks</h1>

      <div className="employee-form">

        <input
          type="text"
          placeholder="Task Name"
          value={taskName}
          onChange={(e) =>
            setTaskName(e.target.value)
          }
        />

        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) =>
            setDescription(e.target.value)
          }
        />

        <select
          value={projectId}
          onChange={(e) =>
            setProjectId(e.target.value)
          }
        >
          <option value="">
            {
              projects.length === 0
                ? "No projects available — create one first"
                : "Select project…"
            }
          </option>
          {
            projects.map((p) => (
              <option key={p.ID} value={p.ID}>
                #{p.ID} — {p.PROJECT_NAME}
              </option>
            ))
          }
        </select>

        <select
          value={assignedTo}
          onChange={(e) =>
            setAssignedTo(e.target.value)
          }
        >
          <option value="">
            {
              employees.length === 0
                ? "No employees available — create one first"
                : "Select employee…"
            }
          </option>
          {
            employees.map((emp) => (
              <option key={emp.ID} value={emp.ID}>
                {emp.NAME} — {emp.EMAIL}
              </option>
            ))
          }
        </select>

        <button
          onClick={createTask}
          disabled={submitting}
        >
          {submitting ? "Adding…" : "Add Task"}
        </button>

      </div>

      <div className="table-wrapper">

      <table className="employee-table">
        <thead>

          <tr>

            <th>ID</th>

            <th>Task Name</th>

            <th>Description</th>

            <th>Status</th>

            <th>Project ID</th>

            <th>Assigned To</th>

            <th>Actions</th>

          </tr>

        </thead>

        <tbody>

          {
            tasks.map((task) => (

              <tr key={task.ID}>

                <td>{task.ID}</td>

                <td>{task.TASK_NAME}</td>

                <td>{task.DESCRIPTION}</td>

                <td>{task.STATUS}</td>

                <td>{task.PROJECT_ID}</td>

                <td>{task.ASSIGNED_TO}</td>

                <td>

                  <button
                    onClick={() => startTask(task.ID)}
                    className="start-btn"
                  >
                    Start
                  </button>

                  <button
                    onClick={() => completeTask(task.ID)}
                    className="complete-btn"
                  >
                    Complete
                  </button>

                  <button
                    onClick={() => holdTask(task.ID)}
                    className="hold-btn"
                  >
                    Hold
                  </button>

                </td>

              </tr>
            ))
          }

        </tbody>
      </table>

      </div>

    </div>
  );
}

export default Tasks;
