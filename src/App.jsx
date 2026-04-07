import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

const STORAGE_KEYS = {
  employees: "ems_employees",
  projects: "ems_projects",
  assignments: "ems_assignments",
  workEntries: "ems_work_entries",
  logs: "ems_logs"
};

const emptyEmployee = {
  id: null,
  emp_no: "",
  name_en: "",
  name_ar: "",
  designation: "",
  rig_no: "",
  shift: "",
  camp_no: "",
  room_no: "",
  status: "",
  notes: ""
};

const emptyProject = {
  id: null,
  project_name: "",
  project_code: "",
  location: "",
  status: "",
  notes: ""
};

const emptyAssignment = {
  employee_id: "",
  project_id: "",
  notes: ""
};

const emptyWorkEntry = {
  employee_id: "",
  work_date: "",
  regular_hours: "",
  overtime_hours: "",
  notes: ""
};

function nowStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function readRows(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function writeRows(key, rows) {
  localStorage.setItem(key, JSON.stringify(rows));
}

function uid() {
  return Date.now() + Math.floor(Math.random() * 100000);
}

function logChange(entityType, entityId, action, details) {
  const logs = readRows(STORAGE_KEYS.logs);
  logs.unshift({
    id: uid(),
    entity_type: entityType,
    entity_id: String(entityId ?? ""),
    action,
    details,
    created_at: nowStamp()
  });
  writeRows(STORAGE_KEYS.logs, logs);
}

function exportRowsToExcel(rows, sheetName, fileName) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || "Sheet1");
  XLSX.writeFile(workbook, `${fileName || "export"}.xlsx`);
}

function downloadJsonBackup() {
  const payload = {
    employees: readRows(STORAGE_KEYS.employees),
    projects: readRows(STORAGE_KEYS.projects),
    assignments: readRows(STORAGE_KEYS.assignments),
    workEntries: readRows(STORAGE_KEYS.workEntries),
    logs: readRows(STORAGE_KEYS.logs)
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `employee-system-backup-${nowStamp().replace(/[: ]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function enrichData() {
  const employeesRaw = readRows(STORAGE_KEYS.employees);
  const projectsRaw = readRows(STORAGE_KEYS.projects);
  const assignmentsRaw = readRows(STORAGE_KEYS.assignments);
  const workEntriesRaw = readRows(STORAGE_KEYS.workEntries);
  const logsRaw = readRows(STORAGE_KEYS.logs);

  const assignmentByEmployeeId = new Map(assignmentsRaw.map((a) => [Number(a.employee_id), a]));
  const projectById = new Map(projectsRaw.map((p) => [Number(p.id), p]));
  const employeeById = new Map(employeesRaw.map((e) => [Number(e.id), e]));

  const employees = employeesRaw.map((emp) => {
    const assignment = assignmentByEmployeeId.get(Number(emp.id));
    const project = assignment ? projectById.get(Number(assignment.project_id)) : null;
    return {
      ...emp,
      current_project: project?.project_name || "",
      current_project_id: project?.id || null
    };
  });

  const projects = projectsRaw.map((project) => ({
    ...project,
    employees_count: assignmentsRaw.filter((a) => Number(a.project_id) === Number(project.id)).length
  }));

  const assignments = assignmentsRaw
    .map((a) => {
      const employee = employeeById.get(Number(a.employee_id));
      const project = projectById.get(Number(a.project_id));
      if (!employee || !project) return null;
      return {
        ...a,
        emp_no: employee.emp_no,
        name_en: employee.name_en,
        designation: employee.designation,
        project_name: project.project_name,
        project_code: project.project_code
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.assigned_at).localeCompare(String(a.assigned_at)));

  const workEntries = workEntriesRaw
    .map((w) => {
      const employee = employeeById.get(Number(w.employee_id));
      const project = projectById.get(Number(w.project_id));
      if (!employee || !project) return null;
      return {
        ...w,
        emp_no: employee.emp_no,
        name_en: employee.name_en,
        designation: employee.designation,
        project_name: project.project_name
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)));

  const hoursMap = new Map();
  employees.forEach((emp) => {
    hoursMap.set(Number(emp.id), {
      employee_id: emp.id,
      emp_no: emp.emp_no,
      name_en: emp.name_en,
      designation: emp.designation,
      current_project: emp.current_project || "",
      total_regular_hours: 0,
      total_overtime_hours: 0,
      total_hours: 0
    });
  });

  workEntriesRaw.forEach((w) => {
    const row = hoursMap.get(Number(w.employee_id));
    if (!row) return;
    row.total_regular_hours += Number(w.regular_hours || 0);
    row.total_overtime_hours += Number(w.overtime_hours || 0);
    row.total_hours = row.total_regular_hours + row.total_overtime_hours;
  });

  const hoursSummary = Array.from(hoursMap.values()).sort((a, b) =>
    String(a.name_en || "").localeCompare(String(b.name_en || ""))
  );

  const stats = {
    totalEmployees: employees.length,
    totalProjects: projects.length,
    assignedEmployees: assignments.length,
    unassignedEmployees: employees.length - assignments.length,
    totalRegularHours: hoursSummary.reduce((sum, row) => sum + Number(row.total_regular_hours || 0), 0),
    totalOvertimeHours: hoursSummary.reduce((sum, row) => sum + Number(row.total_overtime_hours || 0), 0)
  };

  return {
    employees,
    projects,
    assignments,
    workEntries,
    hoursSummary,
    logs: logsRaw.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    stats
  };
}

export default function App() {
  const employeeImportRef = useRef(null);
  const backupImportRef = useRef(null);

  const [activeTab, setActiveTab] = useState("dashboard");

  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignment);
  const [workEntryForm, setWorkEntryForm] = useState(emptyWorkEntry);

  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [workEntries, setWorkEntries] = useState([]);
  const [hoursSummary, setHoursSummary] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    totalProjects: 0,
    assignedEmployees: 0,
    unassignedEmployees: 0,
    totalRegularHours: 0,
    totalOvertimeHours: 0
  });

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProjectEmployees, setSelectedProjectEmployees] = useState([]);

  const [searchEmployee, setSearchEmployee] = useState("");
  const [searchProject, setSearchProject] = useState("");
  const [searchAssignment, setSearchAssignment] = useState("");
  const [searchHours, setSearchHours] = useState("");
  const [searchLogs, setSearchLogs] = useState("");

  const [isEditingEmployee, setIsEditingEmployee] = useState(false);
  const [isEditingProject, setIsEditingProject] = useState(false);

  const refreshAll = () => {
    const data = enrichData();
    setEmployees(data.employees);
    setProjects(data.projects);
    setAssignments(data.assignments);
    setWorkEntries(data.workEntries);
    setHoursSummary(data.hoursSummary);
    setLogs(data.logs);
    setStats(data.stats);
  };

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProjectEmployees([]);
      return;
    }

    const employeesRaw = readRows(STORAGE_KEYS.employees);
    const assignmentsRaw = readRows(STORAGE_KEYS.assignments);
    const employeesMap = new Map(employeesRaw.map((e) => [Number(e.id), e]));

    const rows = assignmentsRaw
      .filter((a) => Number(a.project_id) === Number(selectedProjectId))
      .map((a) => {
        const emp = employeesMap.get(Number(a.employee_id));
        if (!emp) return null;
        return {
          ...emp,
          assigned_at: a.assigned_at,
          assignment_notes: a.notes || ""
        };
      })
      .filter(Boolean);

    setSelectedProjectEmployees(rows);
  }, [selectedProjectId, employees, assignments]);

  const handleEmployeeChange = (e) => {
    const { name, value } = e.target;
    setEmployeeForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleProjectChange = (e) => {
    const { name, value } = e.target;
    setProjectForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAssignmentChange = (e) => {
    const { name, value } = e.target;
    setAssignmentForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleWorkEntryChange = (e) => {
    const { name, value } = e.target;
    setWorkEntryForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetEmployeeForm = () => {
    setEmployeeForm(emptyEmployee);
    setIsEditingEmployee(false);
  };

  const resetProjectForm = () => {
    setProjectForm(emptyProject);
    setIsEditingProject(false);
  };

  const saveEmployee = () => {
    if (!employeeForm.emp_no.trim() || !employeeForm.name_en.trim() || !employeeForm.designation.trim()) {
      alert("Please enter Emp No, Employee Name EN, and Designation.");
      return;
    }

    const rows = readRows(STORAGE_KEYS.employees);

    const duplicate = rows.find(
      (row) => String(row.emp_no).trim() === String(employeeForm.emp_no).trim() && Number(row.id) !== Number(employeeForm.id)
    );

    if (duplicate) {
      alert("Emp No already exists.");
      return;
    }

    if (isEditingEmployee) {
      const updated = rows.map((row) =>
        Number(row.id) === Number(employeeForm.id)
          ? { ...row, ...employeeForm, updated_at: nowStamp() }
          : row
      );
      writeRows(STORAGE_KEYS.employees, updated);
      logChange("employee", employeeForm.id, "UPDATE", `Updated employee ${employeeForm.emp_no} - ${employeeForm.name_en}`);
      alert("Employee updated successfully.");
    } else {
      const row = {
        ...employeeForm,
        id: uid(),
        created_at: nowStamp(),
        updated_at: nowStamp()
      };
      rows.unshift(row);
      writeRows(STORAGE_KEYS.employees, rows);
      logChange("employee", row.id, "CREATE", `Added employee ${row.emp_no} - ${row.name_en}`);
      alert("Employee added successfully.");
    }

    resetEmployeeForm();
    refreshAll();
  };

  const startEditEmployee = (emp) => {
    setEmployeeForm({
      id: emp.id,
      emp_no: emp.emp_no || "",
      name_en: emp.name_en || "",
      name_ar: emp.name_ar || "",
      designation: emp.designation || "",
      rig_no: emp.rig_no || "",
      shift: emp.shift || "",
      camp_no: emp.camp_no || "",
      room_no: emp.room_no || "",
      status: emp.status || "",
      notes: emp.notes || ""
    });
    setIsEditingEmployee(true);
    setActiveTab("employees");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteEmployee = (id) => {
    const ok = window.confirm("Are you sure you want to delete this employee?");
    if (!ok) return;

    const rows = readRows(STORAGE_KEYS.employees).filter((row) => Number(row.id) !== Number(id));
    writeRows(STORAGE_KEYS.employees, rows);

    const assignmentsRows = readRows(STORAGE_KEYS.assignments).filter((a) => Number(a.employee_id) !== Number(id));
    writeRows(STORAGE_KEYS.assignments, assignmentsRows);

    const workRows = readRows(STORAGE_KEYS.workEntries).filter((w) => Number(w.employee_id) !== Number(id));
    writeRows(STORAGE_KEYS.workEntries, workRows);

    logChange("employee", id, "DELETE", `Deleted employee ID ${id}`);
    if (Number(employeeForm.id) === Number(id)) resetEmployeeForm();
    refreshAll();
    alert("Employee deleted successfully.");
  };

  const saveProject = () => {
    if (!projectForm.project_name.trim()) {
      alert("Please enter Project Name.");
      return;
    }

    const rows = readRows(STORAGE_KEYS.projects);
    const duplicate = rows.find(
      (row) => row.project_name.trim().toLowerCase() === projectForm.project_name.trim().toLowerCase() && Number(row.id) !== Number(projectForm.id)
    );

    if (duplicate) {
      alert("Project name already exists.");
      return;
    }

    if (isEditingProject) {
      const updated = rows.map((row) =>
        Number(row.id) === Number(projectForm.id)
          ? { ...row, ...projectForm, updated_at: nowStamp() }
          : row
      );
      writeRows(STORAGE_KEYS.projects, updated);
      logChange("project", projectForm.id, "UPDATE", `Updated project ${projectForm.project_name}`);
      alert("Project updated successfully.");
    } else {
      const row = {
        ...projectForm,
        id: uid(),
        created_at: nowStamp(),
        updated_at: nowStamp()
      };
      rows.unshift(row);
      writeRows(STORAGE_KEYS.projects, rows);
      logChange("project", row.id, "CREATE", `Added project ${row.project_name}`);
      alert("Project added successfully.");
    }

    resetProjectForm();
    refreshAll();
  };

  const startEditProject = (project) => {
    setProjectForm({
      id: project.id,
      project_name: project.project_name || "",
      project_code: project.project_code || "",
      location: project.location || "",
      status: project.status || "",
      notes: project.notes || ""
    });
    setIsEditingProject(true);
    setActiveTab("projects");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteProject = (id) => {
    const ok = window.confirm("Are you sure you want to delete this project?");
    if (!ok) return;

    const rows = readRows(STORAGE_KEYS.projects).filter((row) => Number(row.id) !== Number(id));
    writeRows(STORAGE_KEYS.projects, rows);

    const assignmentsRows = readRows(STORAGE_KEYS.assignments).filter((a) => Number(a.project_id) !== Number(id));
    writeRows(STORAGE_KEYS.assignments, assignmentsRows);

    const workRows = readRows(STORAGE_KEYS.workEntries).filter((w) => Number(w.project_id) !== Number(id));
    writeRows(STORAGE_KEYS.workEntries, workRows);

    logChange("project", id, "DELETE", `Deleted project ID ${id}`);

    if (Number(selectedProjectId) === Number(id)) {
      setSelectedProjectId("");
      setSelectedProjectEmployees([]);
    }
    if (Number(projectForm.id) === Number(id)) resetProjectForm();
    refreshAll();
    alert("Project deleted successfully.");
  };

  const saveAssignment = () => {
    if (!assignmentForm.employee_id || !assignmentForm.project_id) {
      alert("Please select employee and project.");
      return;
    }

    const rows = readRows(STORAGE_KEYS.assignments);
    const existing = rows.find((row) => Number(row.employee_id) === Number(assignmentForm.employee_id));
    const projectsRows = readRows(STORAGE_KEYS.projects);
    const employeesRows = readRows(STORAGE_KEYS.employees);
    const project = projectsRows.find((p) => Number(p.id) === Number(assignmentForm.project_id));
    const employee = employeesRows.find((e) => Number(e.id) === Number(assignmentForm.employee_id));

    if (existing) {
      const updated = rows.map((row) =>
        Number(row.employee_id) === Number(assignmentForm.employee_id)
          ? {
              ...row,
              project_id: Number(assignmentForm.project_id),
              notes: assignmentForm.notes || "",
              assigned_at: nowStamp()
            }
          : row
      );
      writeRows(STORAGE_KEYS.assignments, updated);
      logChange(
        "assignment",
        assignmentForm.employee_id,
        "TRANSFER",
        `Transferred ${employee?.name_en || "employee"} to ${project?.project_name || "project"}`
      );
      alert("Employee transferred successfully.");
    } else {
      rows.unshift({
        id: uid(),
        employee_id: Number(assignmentForm.employee_id),
        project_id: Number(assignmentForm.project_id),
        assigned_at: nowStamp(),
        notes: assignmentForm.notes || ""
      });
      writeRows(STORAGE_KEYS.assignments, rows);
      logChange(
        "assignment",
        assignmentForm.employee_id,
        "ASSIGN",
        `Assigned ${employee?.name_en || "employee"} to ${project?.project_name || "project"}`
      );
      alert("Employee assigned successfully.");
    }

    setAssignmentForm(emptyAssignment);
    refreshAll();
  };

  const unassignEmployee = (employeeId) => {
    const ok = window.confirm("Remove this employee from the current project?");
    if (!ok) return;

    const rows = readRows(STORAGE_KEYS.assignments).filter((row) => Number(row.employee_id) !== Number(employeeId));
    writeRows(STORAGE_KEYS.assignments, rows);
    logChange("assignment", employeeId, "UNASSIGN", `Unassigned employee ID ${employeeId}`);
    refreshAll();
    alert("Employee unassigned successfully.");
  };

  const saveWorkEntry = () => {
    if (!workEntryForm.employee_id || !workEntryForm.work_date) {
      alert("Please select employee and work date.");
      return;
    }

    const assignmentsRows = readRows(STORAGE_KEYS.assignments);
    const assignment = assignmentsRows.find((a) => Number(a.employee_id) === Number(workEntryForm.employee_id));

    if (!assignment) {
      alert("This employee is not assigned to any project.");
      return;
    }

    const rows = readRows(STORAGE_KEYS.workEntries);
    rows.unshift({
      id: uid(),
      employee_id: Number(workEntryForm.employee_id),
      project_id: Number(assignment.project_id),
      work_date: workEntryForm.work_date,
      regular_hours: Number(workEntryForm.regular_hours || 0),
      overtime_hours: Number(workEntryForm.overtime_hours || 0),
      notes: workEntryForm.notes || "",
      created_at: nowStamp()
    });

    writeRows(STORAGE_KEYS.workEntries, rows);
    logChange("work_entry", workEntryForm.employee_id, "CREATE", `Added hours on ${workEntryForm.work_date}`);
    setWorkEntryForm(emptyWorkEntry);
    refreshAll();
    alert("Work entry saved successfully.");
  };

  const deleteWorkEntry = (id) => {
    const ok = window.confirm("Delete this work entry?");
    if (!ok) return;
    const rows = readRows(STORAGE_KEYS.workEntries).filter((row) => Number(row.id) !== Number(id));
    writeRows(STORAGE_KEYS.workEntries, rows);
    logChange("work_entry", id, "DELETE", `Deleted work entry ID ${id}`);
    refreshAll();
    alert("Work entry deleted successfully.");
  };

  const handleImportEmployees = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const existing = readRows(STORAGE_KEYS.employees);
      let added = 0;
      let updated = 0;

      json.forEach((row) => {
        const empNo = String(row.emp_no || row["Emp No"] || row["EMP NO"] || row["Employee No"] || "").trim();
        if (!empNo) return;

        const payload = {
          emp_no: empNo,
          name_en: String(row.name_en || row["Name EN"] || row["Employee Name EN"] || "").trim(),
          name_ar: String(row.name_ar || row["Name AR"] || row["Employee Name AR"] || "").trim(),
          designation: String(row.designation || row["Designation"] || "").trim(),
          rig_no: String(row.rig_no || row["Rig No"] || "").trim(),
          shift: String(row.shift || row["Shift"] || "").trim(),
          camp_no: String(row.camp_no || row["Camp No"] || "").trim(),
          room_no: String(row.room_no || row["Room No"] || "").trim(),
          status: String(row.status || row["Status"] || "").trim(),
          notes: String(row.notes || row["Notes"] || "").trim()
        };

        const index = existing.findIndex((item) => String(item.emp_no).trim() === empNo);
        if (index >= 0) {
          existing[index] = {
            ...existing[index],
            ...payload,
            updated_at: nowStamp()
          };
          updated += 1;
        } else {
          existing.unshift({
            id: uid(),
            ...payload,
            created_at: nowStamp(),
            updated_at: nowStamp()
          });
          added += 1;
        }
      });

      writeRows(STORAGE_KEYS.employees, existing);
      logChange("employee", "bulk", "IMPORT", `Imported employees from Excel. Added: ${added}, Updated: ${updated}`);
      refreshAll();
      alert(`Import completed. Added: ${added}, Updated: ${updated}`);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    }

    e.target.value = "";
  };

  const handleImportBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      writeRows(STORAGE_KEYS.employees, Array.isArray(data.employees) ? data.employees : []);
      writeRows(STORAGE_KEYS.projects, Array.isArray(data.projects) ? data.projects : []);
      writeRows(STORAGE_KEYS.assignments, Array.isArray(data.assignments) ? data.assignments : []);
      writeRows(STORAGE_KEYS.workEntries, Array.isArray(data.workEntries) ? data.workEntries : []);
      writeRows(STORAGE_KEYS.logs, Array.isArray(data.logs) ? data.logs : []);
      refreshAll();
      alert("Backup restored successfully.");
    } catch (error) {
      alert(`Restore failed: ${error.message}`);
    }

    e.target.value = "";
  };

  const printCurrentPage = () => {
    if (activeTab === "project_view" && !selectedProjectId) {
      alert("Please select a project first.");
      return;
    }
    window.print();
  };

  const filteredEmployees = useMemo(() => {
    const q = searchEmployee.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [e.emp_no, e.name_en, e.name_ar, e.designation, e.current_project, e.status, e.shift, e.rig_no]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [employees, searchEmployee]);

  const filteredProjects = useMemo(() => {
    const q = searchProject.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.project_name, p.project_code, p.location, p.status, p.notes].join(" ").toLowerCase().includes(q)
    );
  }, [projects, searchProject]);

  const filteredAssignments = useMemo(() => {
    const q = searchAssignment.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) =>
      [a.emp_no, a.name_en, a.designation, a.project_name, a.project_code].join(" ").toLowerCase().includes(q)
    );
  }, [assignments, searchAssignment]);

  const filteredWorkEntries = useMemo(() => {
    const q = searchHours.trim().toLowerCase();
    if (!q) return workEntries;
    return workEntries.filter((w) =>
      [w.emp_no, w.name_en, w.project_name, w.work_date, w.notes].join(" ").toLowerCase().includes(q)
    );
  }, [workEntries, searchHours]);

  const filteredLogs = useMemo(() => {
    const q = searchLogs.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) =>
      [l.entity_type, l.entity_id, l.action, l.details, l.created_at].join(" ").toLowerCase().includes(q)
    );
  }, [logs, searchLogs]);

  const selectedProject = useMemo(() => {
    return projects.find((p) => String(p.id) === String(selectedProjectId)) || null;
  }, [projects, selectedProjectId]);

  const groupedProjectEmployees = useMemo(() => {
    if (!selectedProjectEmployees.length) return [];
    const map = new Map();

    selectedProjectEmployees.forEach((emp) => {
      const designation = (emp.designation || "Uncategorized").trim() || "Uncategorized";
      if (!map.has(designation)) map.set(designation, []);
      map.get(designation).push(emp);
    });

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([designation, items]) => ({
        designation,
        count: items.length,
        items: [...items].sort((a, b) => String(a.name_en || "").localeCompare(String(b.name_en || "")))
      }));
  }, [selectedProjectEmployees]);

  return (
    <div style={pageStyle}>
      <style>{globalStyles}</style>

      <div style={backgroundGlowOne}></div>
      <div style={backgroundGlowTwo}></div>

      <div style={containerStyle}>
        <div className="no-print" style={heroCard}>
          <div style={heroBadge}>Web App Version</div>
          <h1 style={heroTitle}>Employee Management & Allocation System</h1>
          <p style={heroSubtitle}>
            Browser-based app with Local Storage, Excel Import/Export, Project Allocation, Work Hours, OT, and Logs
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 16 }}>
            <button type="button" onClick={downloadJsonBackup} style={{ ...buttonStyle, background: buttonSuccess }}>
              Backup JSON
            </button>
            <input ref={backupImportRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportBackup} />
            <button type="button" onClick={() => backupImportRef.current?.click()} style={{ ...buttonStyle, background: buttonPurple }}>
              Restore JSON
            </button>
          </div>
        </div>

        <div className="no-print" style={tabsWrap}>
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "employees", label: "Employees" },
            { key: "projects", label: "Projects" },
            { key: "assignments", label: "Assignments" },
            { key: "hours", label: "Work Hours" },
            { key: "project_view", label: "Project Employees" },
            { key: "logs", label: "Logs" }
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{ ...tabButton, ...(activeTab === tab.key ? activeTabButton : {}) }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "dashboard" && (
          <>
            <div style={statsGrid}>
              <StatCard title="Total Employees" value={stats.totalEmployees} icon="👥" />
              <StatCard title="Total Projects" value={stats.totalProjects} icon="🏗️" />
              <StatCard title="Assigned Employees" value={stats.assignedEmployees} icon="📌" />
              <StatCard title="Unassigned Employees" value={stats.unassignedEmployees} icon="📂" />
              <StatCard title="Regular Hours" value={stats.totalRegularHours} icon="⏱️" />
              <StatCard title="Overtime Hours" value={stats.totalOvertimeHours} icon="🌙" />
            </div>

            <div style={cardStyle}>
              <SectionHeaderWithActions
                title="Employee Hours Summary"
                onExportExcel={() =>
                  exportRowsToExcel(
                    hoursSummary.map((row) => ({
                      "Emp No": row.emp_no,
                      Employee: row.name_en,
                      Designation: row.designation,
                      "Current Project": row.current_project,
                      "Regular Hours": row.total_regular_hours,
                      "OT Hours": row.total_overtime_hours,
                      "Total Hours": row.total_hours
                    })),
                    "Hours Summary",
                    "hours_summary"
                  )
                }
                onPrint={printCurrentPage}
              />

              <div className="print-area">
                <div className="print-report-title">Employee Hours Summary</div>
                <div className="print-report-subtitle">Generated from Employee Management & Allocation System</div>
                <div className="print-table-wrap" style={tableWrap}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Emp No</th>
                        <th style={thStyle}>Employee</th>
                        <th style={thStyle}>Designation</th>
                        <th style={thStyle}>Current Project</th>
                        <th style={thStyle}>Regular Hours</th>
                        <th style={thStyle}>OT Hours</th>
                        <th style={thStyle}>Total Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoursSummary.length > 0 ? (
                        hoursSummary.map((row) => (
                          <tr key={row.employee_id}>
                            <td style={tdStyle}>{row.emp_no}</td>
                            <td style={tdStyle}>{row.name_en}</td>
                            <td style={tdStyle}>{row.designation}</td>
                            <td style={tdStyle}>{row.current_project || "-"}</td>
                            <td style={tdStyle}>{row.total_regular_hours}</td>
                            <td style={tdStyle}>{row.total_overtime_hours}</td>
                            <td style={tdStyle}>{row.total_hours}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td style={emptyTd} colSpan="7">No data found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "employees" && (
          <>
            <div className="no-print" style={cardStyle}>
              <SectionHeaderWithActions
                title={isEditingEmployee ? "Edit Employee" : "Add Employee"}
                extraButtons={
                  <>
                    <input ref={employeeImportRef} type="file" accept=".xlsx,.xls" onChange={handleImportEmployees} style={{ display: "none" }} />
                    <button type="button" onClick={() => employeeImportRef.current?.click()} style={{ ...buttonStyle, background: buttonPurple }}>
                      Import Employees Excel
                    </button>
                  </>
                }
              />

              <div style={formGrid4}>
                <input type="text" autoComplete="off" name="emp_no" placeholder="Emp No *" value={employeeForm.emp_no} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="name_en" placeholder="Employee Name EN *" value={employeeForm.name_en} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="name_ar" placeholder="Employee Name AR" value={employeeForm.name_ar} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="designation" placeholder="Designation *" value={employeeForm.designation} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="rig_no" placeholder="Rig No" value={employeeForm.rig_no} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="shift" placeholder="Shift" value={employeeForm.shift} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="camp_no" placeholder="Camp No" value={employeeForm.camp_no} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="room_no" placeholder="Room No" value={employeeForm.room_no} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="status" placeholder="Status" value={employeeForm.status} onChange={handleEmployeeChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="notes" placeholder="Notes" value={employeeForm.notes} onChange={handleEmployeeChange} style={{ ...inputStyle, gridColumn: "span 3" }} />
              </div>

              <div style={actionRow}>
                <button type="button" onClick={saveEmployee} style={{ ...buttonStyle, background: isEditingEmployee ? buttonSuccess : buttonPrimary }}>
                  {isEditingEmployee ? "Update Employee" : "Add Employee"}
                </button>
                {isEditingEmployee && (
                  <button type="button" onClick={resetEmployeeForm} style={{ ...buttonStyle, background: buttonMuted }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div style={cardStyle}>
              <SectionHeaderWithSearchAndActions
                title="Employees List"
                value={searchEmployee}
                onChange={setSearchEmployee}
                placeholder="Search employees..."
                onExportExcel={() =>
                  exportRowsToExcel(
                    filteredEmployees.map((emp) => ({
                      "Emp No": emp.emp_no,
                      "Name EN": emp.name_en,
                      "Name AR": emp.name_ar,
                      Designation: emp.designation,
                      "Rig No": emp.rig_no,
                      Shift: emp.shift,
                      "Current Project": emp.current_project || "",
                      Status: emp.status || "",
                      Notes: emp.notes || ""
                    })),
                    "Employees",
                    "employees_list"
                  )
                }
                onPrint={printCurrentPage}
              />

              <div className="print-area">
                <div className="print-report-title">Employees List</div>
                <div className="print-report-subtitle">Generated from Employee Management & Allocation System</div>
                <div style={subInfoText} className="no-print">
                  Showing <strong style={{ color: "#ffffff" }}>{filteredEmployees.length}</strong> record(s)
                </div>
                <div className="print-table-wrap" style={tableWrap}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Emp No</th>
                        <th style={thStyle}>Name EN</th>
                        <th style={thStyle}>Name AR</th>
                        <th style={thStyle}>Designation</th>
                        <th style={thStyle}>Rig</th>
                        <th style={thStyle}>Shift</th>
                        <th style={thStyle}>Current Project</th>
                        <th style={thStyle}>Status</th>
                        <th className="no-print" style={thStyle}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.length > 0 ? (
                        filteredEmployees.map((emp) => (
                          <tr key={emp.id}>
                            <td style={tdStyle}>{emp.emp_no}</td>
                            <td style={tdStyle}>{emp.name_en}</td>
                            <td style={tdStyle}>{emp.name_ar}</td>
                            <td style={tdStyle}>{emp.designation}</td>
                            <td style={tdStyle}>{emp.rig_no}</td>
                            <td style={tdStyle}>{emp.shift}</td>
                            <td style={tdStyle}>{emp.current_project || "-"}</td>
                            <td style={tdStyle}>{emp.status || "-"}</td>
                            <td className="no-print" style={tdStyle}>
                              <div style={smallActionWrap}>
                                <button type="button" onClick={() => startEditEmployee(emp)} style={{ ...miniButton, background: buttonWarning }}>Edit</button>
                                <button type="button" onClick={() => deleteEmployee(emp.id)} style={{ ...miniButton, background: buttonDanger }}>Delete</button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td style={emptyTd} colSpan="9">No employees found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "projects" && (
          <>
            <div className="no-print" style={cardStyle}>
              <SectionTitle title={isEditingProject ? "Edit Project" : "Add Project"} />

              <div style={formGrid4}>
                <input type="text" autoComplete="off" name="project_name" placeholder="Project Name *" value={projectForm.project_name} onChange={handleProjectChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="project_code" placeholder="Project Code" value={projectForm.project_code} onChange={handleProjectChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="location" placeholder="Location" value={projectForm.location} onChange={handleProjectChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="status" placeholder="Status" value={projectForm.status} onChange={handleProjectChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="notes" placeholder="Notes" value={projectForm.notes} onChange={handleProjectChange} style={{ ...inputStyle, gridColumn: "span 4" }} />
              </div>

              <div style={subInfoText}>
                Current typed project: <strong style={{ color: "#ffffff" }}>{projectForm.project_name || "(empty)"}</strong>
              </div>

              <div style={actionRow}>
                <button type="button" onClick={saveProject} style={{ ...buttonStyle, background: isEditingProject ? buttonSuccess : buttonPurple }}>
                  {isEditingProject ? "Update Project" : "Add Project"}
                </button>
                {isEditingProject && (
                  <button type="button" onClick={resetProjectForm} style={{ ...buttonStyle, background: buttonMuted }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div style={cardStyle}>
              <SectionHeaderWithSearchAndActions
                title="Projects List"
                value={searchProject}
                onChange={setSearchProject}
                placeholder="Search projects..."
                onExportExcel={() =>
                  exportRowsToExcel(
                    filteredProjects.map((project) => ({
                      "Project Name": project.project_name,
                      "Project Code": project.project_code || "",
                      Location: project.location || "",
                      Status: project.status || "",
                      "Employees Count": project.employees_count,
                      Notes: project.notes || ""
                    })),
                    "Projects",
                    "projects_list"
                  )
                }
                onPrint={printCurrentPage}
              />

              <div className="print-area">
                <div className="print-report-title">Projects List</div>
                <div className="print-report-subtitle">Generated from Employee Management & Allocation System</div>
                <div className="print-table-wrap" style={tableWrap}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Project Name</th>
                        <th style={thStyle}>Code</th>
                        <th style={thStyle}>Location</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>Employees Count</th>
                        <th className="no-print" style={thStyle}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjects.length > 0 ? (
                        filteredProjects.map((project) => (
                          <tr key={project.id}>
                            <td style={tdStyle}>{project.project_name}</td>
                            <td style={tdStyle}>{project.project_code || "-"}</td>
                            <td style={tdStyle}>{project.location || "-"}</td>
                            <td style={tdStyle}>{project.status || "-"}</td>
                            <td style={tdStyle}>{project.employees_count}</td>
                            <td className="no-print" style={tdStyle}>
                              <div style={smallActionWrap}>
                                <button type="button" onClick={() => startEditProject(project)} style={{ ...miniButton, background: buttonWarning }}>Edit</button>
                                <button type="button" onClick={() => { setSelectedProjectId(String(project.id)); setActiveTab("project_view"); }} style={{ ...miniButton, background: buttonPrimary }}>View Employees</button>
                                <button type="button" onClick={() => deleteProject(project.id)} style={{ ...miniButton, background: buttonDanger }}>Delete</button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td style={emptyTd} colSpan="6">No projects found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "assignments" && (
          <>
            <div className="no-print" style={cardStyle}>
              <SectionTitle title="Assign / Transfer Employee to Project" />
              <div style={formGrid3}>
                <select name="employee_id" value={assignmentForm.employee_id} onChange={handleAssignmentChange} style={inputStyle}>
                  <option value="">Select Employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.emp_no} - {emp.name_en}{emp.current_project ? ` | Current: ${emp.current_project}` : " | Unassigned"}
                    </option>
                  ))}
                </select>

                <select name="project_id" value={assignmentForm.project_id} onChange={handleAssignmentChange} style={inputStyle}>
                  <option value="">Select Project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.project_name}</option>
                  ))}
                </select>

                <input type="text" autoComplete="off" name="notes" placeholder="Notes" value={assignmentForm.notes} onChange={handleAssignmentChange} style={inputStyle} />
              </div>
              <div style={actionRow}>
                <button type="button" onClick={saveAssignment} style={{ ...buttonStyle, background: buttonSuccess }}>Assign / Transfer</button>
              </div>
            </div>

            <div style={cardStyle}>
              <SectionHeaderWithSearchAndActions
                title="Current Assignments"
                value={searchAssignment}
                onChange={setSearchAssignment}
                placeholder="Search assignments..."
                onExportExcel={() =>
                  exportRowsToExcel(
                    filteredAssignments.map((row) => ({
                      "Emp No": row.emp_no,
                      Employee: row.name_en,
                      Designation: row.designation,
                      Project: row.project_name,
                      "Project Code": row.project_code || "",
                      "Assigned At": row.assigned_at,
                      Notes: row.notes || ""
                    })),
                    "Assignments",
                    "assignments_list"
                  )
                }
                onPrint={printCurrentPage}
              />

              <div className="print-area">
                <div className="print-report-title">Current Assignments</div>
                <div className="print-report-subtitle">Generated from Employee Management & Allocation System</div>
                <div className="print-table-wrap" style={tableWrap}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Emp No</th>
                        <th style={thStyle}>Employee</th>
                        <th style={thStyle}>Designation</th>
                        <th style={thStyle}>Project</th>
                        <th style={thStyle}>Assigned At</th>
                        <th style={thStyle}>Notes</th>
                        <th className="no-print" style={thStyle}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssignments.length > 0 ? (
                        filteredAssignments.map((row) => (
                          <tr key={row.id}>
                            <td style={tdStyle}>{row.emp_no}</td>
                            <td style={tdStyle}>{row.name_en}</td>
                            <td style={tdStyle}>{row.designation}</td>
                            <td style={tdStyle}>{row.project_name}</td>
                            <td style={tdStyle}>{row.assigned_at}</td>
                            <td style={tdStyle}>{row.notes || "-"}</td>
                            <td className="no-print" style={tdStyle}>
                              <button type="button" onClick={() => unassignEmployee(row.employee_id)} style={{ ...miniButton, background: buttonDanger }}>Unassign</button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td style={emptyTd} colSpan="7">No assignments found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "hours" && (
          <>
            <div className="no-print" style={cardStyle}>
              <SectionTitle title="Add Work Hours / Overtime" />
              <div style={formGrid4}>
                <select name="employee_id" value={workEntryForm.employee_id} onChange={handleWorkEntryChange} style={inputStyle}>
                  <option value="">Select Employee</option>
                  {employees.filter((e) => e.current_project).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.emp_no} - {emp.name_en} | {emp.current_project}</option>
                  ))}
                </select>
                <input type="date" name="work_date" value={workEntryForm.work_date} onChange={handleWorkEntryChange} style={inputStyle} />
                <input type="number" step="0.5" name="regular_hours" placeholder="Regular Hours" value={workEntryForm.regular_hours} onChange={handleWorkEntryChange} style={inputStyle} />
                <input type="number" step="0.5" name="overtime_hours" placeholder="Overtime Hours" value={workEntryForm.overtime_hours} onChange={handleWorkEntryChange} style={inputStyle} />
                <input type="text" autoComplete="off" name="notes" placeholder="Notes" value={workEntryForm.notes} onChange={handleWorkEntryChange} style={{ ...inputStyle, gridColumn: "span 4" }} />
              </div>
              <div style={actionRow}>
                <button type="button" onClick={saveWorkEntry} style={{ ...buttonStyle, background: buttonPrimary }}>Save Work Entry</button>
              </div>
            </div>

            <div style={cardStyle}>
              <SectionHeaderWithSearchAndActions
                title="Work Entries"
                value={searchHours}
                onChange={setSearchHours}
                placeholder="Search work entries..."
                onExportExcel={() =>
                  exportRowsToExcel(
                    filteredWorkEntries.map((row) => ({
                      Date: row.work_date,
                      "Emp No": row.emp_no,
                      Employee: row.name_en,
                      Project: row.project_name,
                      "Regular Hours": row.regular_hours,
                      "OT Hours": row.overtime_hours,
                      Notes: row.notes || ""
                    })),
                    "Work Entries",
                    "work_entries"
                  )
                }
                onPrint={printCurrentPage}
              />

              <div className="print-area">
                <div className="print-report-title">Work Entries</div>
                <div className="print-report-subtitle">Generated from Employee Management & Allocation System</div>
                <div className="print-table-wrap" style={tableWrap}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Emp No</th>
                        <th style={thStyle}>Employee</th>
                        <th style={thStyle}>Project</th>
                        <th style={thStyle}>Regular Hours</th>
                        <th style={thStyle}>OT Hours</th>
                        <th style={thStyle}>Notes</th>
                        <th className="no-print" style={thStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWorkEntries.length > 0 ? (
                        filteredWorkEntries.map((row) => (
                          <tr key={row.id}>
                            <td style={tdStyle}>{row.work_date}</td>
                            <td style={tdStyle}>{row.emp_no}</td>
                            <td style={tdStyle}>{row.name_en}</td>
                            <td style={tdStyle}>{row.project_name}</td>
                            <td style={tdStyle}>{row.regular_hours}</td>
                            <td style={tdStyle}>{row.overtime_hours}</td>
                            <td style={tdStyle}>{row.notes || "-"}</td>
                            <td className="no-print" style={tdStyle}>
                              <button type="button" onClick={() => deleteWorkEntry(row.id)} style={{ ...miniButton, background: buttonDanger }}>Delete</button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td style={emptyTd} colSpan="8">No work entries found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "project_view" && (
          <>
            <div className="no-print" style={cardStyle}>
              <SectionTitle title="Project Employees" />
              <div style={formGrid2}>
                <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} style={inputStyle}>
                  <option value="">Select Project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.project_name}</option>
                  ))}
                </select>
                <div style={projectInfoBox}>
                  {selectedProjectId ? `Employees on selected project: ${selectedProjectEmployees.length}` : "Choose a project to view its employees"}
                </div>
              </div>
            </div>

            <div style={cardStyle}>
              <SectionHeaderWithActions
                title={selectedProject ? `Selected Project Employees - ${selectedProject.project_name}` : "Selected Project Employees"}
                onExportExcel={() =>
                  exportRowsToExcel(
                    groupedProjectEmployees.flatMap((group) =>
                      group.items.map((row, index) => ({
                        Group: index === 0 ? `${group.designation} - ${group.count}` : "",
                        "Emp No": row.emp_no,
                        Employee: row.name_en,
                        "Employee Name AR": row.name_ar || "",
                        Designation: row.designation,
                        Shift: row.shift || "",
                        Project: selectedProject?.project_name || "",
                        "Camp No": row.camp_no || "",
                        "Room No": row.room_no || "",
                        "Rig No": row.rig_no || "",
                        Status: row.status || "",
                        "Assigned At": row.assigned_at || "",
                        Notes: row.notes || ""
                      }))
                    ),
                    "Project Employees",
                    "project_employees_grouped"
                  )
                }
                onPrint={printCurrentPage}
              />

              <div className="print-area">
                {selectedProjectId && groupedProjectEmployees.length > 0 ? (
                  <>
                    <div className="print-report-title">Employee Allocation Report</div>
                    <div className="print-report-subtitle">
                      Project: {selectedProject?.project_name || "-"}
                      {selectedProject?.project_code ? ` | Code: ${selectedProject.project_code}` : ""}
                    </div>

                    <div style={designationGroupsWrap}>
                      {groupedProjectEmployees.map((group) => (
                        <div key={group.designation} className="designation-group" style={designationGroupCard}>
                          <div style={designationHeader}>
                            <div style={designationHeaderTitle} className="print-group-title">
                              {group.designation.toUpperCase()} - {group.count}
                            </div>
                          </div>

                          <div className="print-table-wrap" style={tableWrap}>
                            <table style={groupTableStyle}>
                              <thead>
                                <tr>
                                  <th style={{ ...thStyleCenter, width: "6%" }}>SR.NO</th>
                                  <th style={{ ...thStyle, width: "12%" }}>EMP.NO</th>
                                  <th style={{ ...thStyle, width: "18%" }}>EMPLOYEE NAME</th>
                                  <th style={{ ...thStyle, width: "18%" }}>EMPLOYEE NAME AR</th>
                                  <th style={{ ...thStyle, width: "16%" }}>DESIGNATION</th>
                                  <th style={{ ...thStyleCenter, width: "8%" }}>SHIFT</th>
                                  <th style={{ ...thStyleCenter, width: "10%" }}>PROJECT</th>
                                  <th style={{ ...thStyleCenter, width: "6%" }}>CAMP NO</th>
                                  <th style={{ ...thStyleCenter, width: "6%" }}>ROOM NO</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((row, index) => (
                                  <tr key={row.id}>
                                    <td style={tdStyleCenter}>{index + 1}</td>
                                    <td style={tdStyle}>{row.emp_no}</td>
                                    <td style={tdStyle}>{row.name_en}</td>
                                    <td style={{ ...tdStyle, direction: "rtl", textAlign: "right" }}>{row.name_ar || "-"}</td>
                                    <td style={tdStyle}>{row.designation || "-"}</td>
                                    <td style={tdStyleCenter}>{row.shift || "N/A"}</td>
                                    <td style={tdStyleCenter}>{selectedProject?.project_code || selectedProject?.project_name || "-"}</td>
                                    <td style={tdStyleCenter}>{row.camp_no || "N/A"}</td>
                                    <td style={tdStyleCenter}>{row.room_no || "N/A"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={emptyGroupBox}>{selectedProjectId ? "No employees found for this project" : "Select a project first"}</div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === "logs" && (
          <div style={cardStyle}>
            <SectionHeaderWithSearchAndActions
              title="System Change Logs"
              value={searchLogs}
              onChange={setSearchLogs}
              placeholder="Search logs..."
              onExportExcel={() =>
                exportRowsToExcel(
                  filteredLogs.map((log) => ({
                    "Date & Time": log.created_at,
                    "Entity Type": log.entity_type,
                    "Entity ID": log.entity_id,
                    Action: log.action,
                    Details: log.details
                  })),
                  "Logs",
                  "system_logs"
                )
              }
              onPrint={printCurrentPage}
            />

            <div className="print-area">
              <div className="print-report-title">System Change Logs</div>
              <div className="print-report-subtitle">Generated from Employee Management & Allocation System</div>
              <div className="print-table-wrap" style={tableWrap}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Date & Time</th>
                      <th style={thStyle}>Entity Type</th>
                      <th style={thStyle}>Entity ID</th>
                      <th style={thStyle}>Action</th>
                      <th style={thStyle}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.length > 0 ? (
                      filteredLogs.map((log) => (
                        <tr key={log.id}>
                          <td style={tdStyle}>{log.created_at}</td>
                          <td style={tdStyle}>{log.entity_type}</td>
                          <td style={tdStyle}>{log.entity_id}</td>
                          <td style={tdStyle}>{log.action}</td>
                          <td style={tdStyle}>{log.details}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td style={emptyTd} colSpan="5">No logs found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }) {
  return (
    <div style={statCard}>
      <div style={statIcon}>{icon}</div>
      <div style={statTitle}>{title}</div>
      <div style={statValue}>{value ?? 0}</div>
    </div>
  );
}

function SectionTitle({ title }) {
  return <h2 style={sectionTitle}>{title}</h2>;
}

function SectionHeaderWithActions({ title, onExportExcel, onPrint, extraButtons }) {
  return (
    <div style={sectionHeaderWrap}>
      <h2 style={sectionTitle}>{title}</h2>
      <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {extraButtons}
        {onExportExcel && (
          <button type="button" onClick={onExportExcel} style={{ ...buttonStyle, background: buttonSuccess }}>Export Excel</button>
        )}
        {onPrint && (
          <button type="button" onClick={onPrint} style={{ ...buttonStyle, background: buttonOrange }}>Print / PDF</button>
        )}
      </div>
    </div>
  );
}

function SectionHeaderWithSearchAndActions({ title, value, onChange, placeholder, onExportExcel, onPrint }) {
  return (
    <div style={sectionHeaderWrap}>
      <h2 style={sectionTitle}>{title}</h2>
      <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, width: 320, maxWidth: "100%" }} />
        {onExportExcel && (
          <button type="button" onClick={onExportExcel} style={{ ...buttonStyle, background: buttonSuccess }}>Export Excel</button>
        )}
        {onPrint && (
          <button type="button" onClick={onPrint} style={{ ...buttonStyle, background: buttonOrange }}>Print / PDF</button>
        )}
      </div>
    </div>
  );
}

const buttonPrimary = "linear-gradient(135deg, #2563eb, #1d4ed8)";
const buttonSuccess = "linear-gradient(135deg, #10b981, #059669)";
const buttonDanger = "linear-gradient(135deg, #ef4444, #dc2626)";
const buttonWarning = "linear-gradient(135deg, #f59e0b, #d97706)";
const buttonPurple = "linear-gradient(135deg, #8b5cf6, #7c3aed)";
const buttonOrange = "linear-gradient(135deg, #f97316, #ea580c)";
const buttonMuted = "linear-gradient(135deg, #64748b, #475569)";

const globalStyles = `
* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; min-height: 100%; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: #0b1222; border-radius: 999px; }
::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #2dd4bf, #2563eb); border-radius: 999px; }
::selection { background: rgba(45, 212, 191, 0.35); }
@page { size: A4 portrait; margin: 10mm; }
@media (max-width: 1100px) {
  .responsive-grid-6 { grid-template-columns: repeat(2, 1fr) !important; }
}
@media (max-width: 900px) {
  .responsive-grid-4, .responsive-grid-3, .responsive-grid-2 { grid-template-columns: 1fr !important; }
}
@media print {
  html, body {
    background: #ffffff !important;
    margin: 0 !important;
    padding: 0 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body * {
    visibility: hidden !important;
  }

  .print-area,
  .print-area * {
    visibility: visible !important;
  }

  .print-area {
    position: static !important;
    width: 100% !important;
    background: #ffffff !important;
    color: #000000 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  .no-print {
    display: none !important;
  }

  .print-table-wrap {
    overflow: visible !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    border: 0 !important;
    background: #fff !important;
  }

  .print-report-title {
    display: block !important;
    text-align: center !important;
    font-size: 18px !important;
    font-weight: 800 !important;
    margin: 0 0 10px 0 !important;
    color: #000 !important;
    text-transform: uppercase !important;
  }

  .print-report-subtitle {
    display: block !important;
    text-align: center !important;
    font-size: 11px !important;
    margin: 0 0 14px 0 !important;
    color: #333 !important;
  }

  .designation-group {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    margin-bottom: 12px !important;
    border: 1px solid #000 !important;
    border-radius: 0 !important;
    background: #fff !important;
    box-shadow: none !important;
    padding: 0 !important;
  }

  table {
    width: 100% !important;
    min-width: 100% !important;
    border-collapse: collapse !important;
    table-layout: fixed !important;
    font-size: 10px !important;
    background: #fff !important;
  }

  thead {
    display: table-header-group !important;
  }

  tfoot {
    display: table-footer-group !important;
  }

  tr {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }

  th, td {
    border: 1px solid #000 !important;
    padding: 5px 4px !important;
    color: #000 !important;
    background: #fff !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    vertical-align: middle !important;
    line-height: 1.3 !important;
  }

  th {
    background: #000 !important;
    color: #fff !important;
    font-weight: 700 !important;
    text-align: center !important;
  }

  .print-group-title {
    text-align: center !important;
    font-size: 13px !important;
    font-weight: 800 !important;
    text-decoration: underline !important;
    margin: 8px 0 6px 0 !important;
    color: #000 !important;
  }
}
`;

const pageStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 30%), radial-gradient(circle at top right, rgba(16,185,129,0.12), transparent 24%), linear-gradient(180deg, #06111f 0%, #09172b 45%, #07101e 100%)",
  color: "#f8fafc",
  padding: 28,
  fontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
  position: "relative",
  overflow: "hidden"
};

const backgroundGlowOne = {
  position: "fixed",
  width: 340,
  height: 340,
  borderRadius: "50%",
  background: "rgba(37, 99, 235, 0.18)",
  filter: "blur(80px)",
  top: -60,
  left: -90,
  pointerEvents: "none"
};

const backgroundGlowTwo = {
  position: "fixed",
  width: 320,
  height: 320,
  borderRadius: "50%",
  background: "rgba(16, 185, 129, 0.12)",
  filter: "blur(90px)",
  bottom: -80,
  right: -80,
  pointerEvents: "none"
};

const containerStyle = {
  maxWidth: 1600,
  margin: "0 auto",
  position: "relative",
  zIndex: 2
};

const heroCard = {
  background: "linear-gradient(135deg, rgba(15,23,42,0.85), rgba(17,24,39,0.72))",
  border: "1px solid rgba(148,163,184,0.16)",
  borderRadius: 24,
  padding: "28px 26px",
  marginBottom: 22,
  boxShadow: "0 20px 50px rgba(0,0,0,0.28)",
  backdropFilter: "blur(14px)"
};

const heroBadge = {
  display: "inline-block",
  padding: "6px 12px",
  borderRadius: 999,
  background: "rgba(45, 212, 191, 0.12)",
  color: "#5eead4",
  fontSize: 13,
  fontWeight: 700,
  border: "1px solid rgba(45,212,191,0.28)",
  marginBottom: 12
};

const heroTitle = {
  margin: 0,
  fontSize: 42,
  fontWeight: 800,
  letterSpacing: "-0.02em",
  textAlign: "center",
  color: "#f8fafc"
};

const heroSubtitle = {
  textAlign: "center",
  color: "#94a3b8",
  marginTop: 10,
  marginBottom: 0,
  fontSize: 16
};

const cardStyle = {
  background: "linear-gradient(180deg, rgba(15,23,42,0.86), rgba(11,18,32,0.92))",
  border: "1px solid rgba(59,130,246,0.14)",
  borderRadius: 22,
  padding: 20,
  marginBottom: 22,
  boxShadow: "0 18px 42px rgba(0,0,0,0.28)",
  backdropFilter: "blur(12px)"
};

const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(6, 1fr)",
  gap: 14,
  marginBottom: 22
};

const statCard = {
  background: "linear-gradient(180deg, rgba(15,23,42,0.95), rgba(16,24,39,0.82))",
  border: "1px solid rgba(96,165,250,0.14)",
  borderRadius: 22,
  padding: 20,
  textAlign: "center",
  boxShadow: "0 12px 30px rgba(0,0,0,0.22)"
};

const statIcon = { fontSize: 24, marginBottom: 10 };
const statTitle = { color: "#94a3b8", marginBottom: 10, fontSize: 15, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1.4 };
const statValue = { fontSize: 34, fontWeight: 800, color: "#ffffff" };

const tabsWrap = { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 };
const tabButton = { padding: "12px 18px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.12)", color: "#e2e8f0", cursor: "pointer", fontWeight: 700, fontSize: 14, background: "rgba(15,23,42,0.86)", transition: "all 0.2s ease", boxShadow: "0 8px 20px rgba(0,0,0,0.18)" };
const activeTabButton = { background: "linear-gradient(135deg, rgba(37,99,235,0.95), rgba(14,165,233,0.88))", color: "#ffffff", border: "1px solid rgba(125,211,252,0.42)", transform: "translateY(-1px)" };

const formGrid4 = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 };
const formGrid3 = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 };
const formGrid2 = { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 };

const inputStyle = { padding: "13px 15px", borderRadius: 14, border: "1px solid rgba(203,213,225,0.18)", background: "rgba(248,250,252,0.95)", color: "#0f172a", fontSize: 14, width: "100%", boxSizing: "border-box", outline: "none", boxShadow: "inset 0 1px 2px rgba(15,23,42,0.08)" };

const actionRow = { display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" };
const buttonStyle = { padding: "11px 18px", borderRadius: 14, border: "none", color: "#ffffff", cursor: "pointer", fontWeight: 700, fontSize: 14, boxShadow: "0 10px 24px rgba(0,0,0,0.22)" };
const miniButton = { padding: "8px 12px", borderRadius: 10, border: "none", color: "#ffffff", cursor: "pointer", fontWeight: 700, fontSize: 13, boxShadow: "0 8px 18px rgba(0,0,0,0.18)" };
const smallActionWrap = { display: "flex", gap: 6, flexWrap: "wrap" };
const sectionHeaderWrap = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 };
const sectionTitle = { margin: 0, fontSize: 22, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.01em" };
const subInfoText = { marginTop: 12, color: "#94a3b8", fontSize: 14 };
const tableWrap = { overflowX: "auto", borderRadius: 12, background: "#ffffff", border: "1px solid rgba(226,232,240,0.75)", boxShadow: "0 12px 26px rgba(0,0,0,0.16)" };
const tableStyle = { width: "100%", minWidth: 1100, borderCollapse: "collapse", background: "rgba(255,255,255,0.97)", color: "#0f172a" };
const groupTableStyle = { width: "100%", minWidth: 1000, borderCollapse: "collapse", background: "#ffffff", color: "#0f172a" };
const thStyle = { padding: 14, textAlign: "left", background: "linear-gradient(180deg, #0b0b0b 0%, #111827 100%)", borderBottom: "1px solid #1f2937", whiteSpace: "nowrap", fontSize: 14, color: "#ffffff", fontWeight: 800 };
const thStyleCenter = { ...thStyle, textAlign: "center" };
const tdStyle = { padding: 14, borderBottom: "1px solid #e5e7eb", verticalAlign: "top", fontSize: 14, color: "#111827", lineHeight: 1.5 };
const tdStyleCenter = { ...tdStyle, textAlign: "center" };
const emptyTd = { padding: 28, textAlign: "center", color: "#64748b", fontWeight: "700", fontSize: 15 };
const projectInfoBox = { background: "linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.92))", border: "1px solid rgba(59,130,246,0.22)", borderRadius: 14, padding: 14, display: "flex", alignItems: "center", color: "#cbd5e1", fontWeight: "700", minHeight: 48 };
const designationGroupsWrap = { display: "flex", flexDirection: "column", gap: 14 };
const designationGroupCard = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 20, padding: 10 };
const designationHeader = { marginBottom: 12, padding: "4px 2px" };
const designationHeaderTitle = { textAlign: "center", color: "#ffffff", fontSize: 24, fontWeight: 800, textDecoration: "underline", letterSpacing: "0.02em" };
const emptyGroupBox = { padding: 30, borderRadius: 18, textAlign: "center", color: "#cbd5e1", background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.14)", fontWeight: 700 };
