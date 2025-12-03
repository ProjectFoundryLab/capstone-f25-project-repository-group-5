[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/OXWeespk)


Project overview

MedBed Systems is a full-stack hospital bed management platform designed to help medical staff view, assign, and track bed availability in real time. The system integrates:
- A secure login system
- Patient management
- Room & bed tracking
- A real-time dashboard
- Backend API services hosted on Google Cloud Run
- A relational MySQL database
- Data visualization dashboards (Looker Studio)

The goal of the project is to streamline patient flow, reduce wait times, and improve hospital resource management.

Setup instructions
1. Clone the repository.
2. Open the project in VS Code.
3. In the frontend folder, run npm install.
4. In the backend folder, run npm install.
5. Add the required .env files for Firebase, Cloud SQL, and the Cloud Run API URLs.

Dependencies

Frontend
- Vue.js
  
Backend
- Node.js
- Google Cloud SQL
  
Other Services
- Firebase Authentication
- Google Cloud Run
 -Google Cloud SQL
- Google Cloud Storage
- Looker Studio

How to run the project
  Frontend: Run this inside the frontend folder: npm run dev
  Backend: Run this inside the backend folder: npm start
  The backend also runs on Google Cloud Run, and the frontend connects using the API URLs in the .env file.

How to view/use the system
1. Log in using your hospital staff credentials
    - Username: sorio@gmail.com
    - Password: soriob
2. Navigate to the dashboard to view:
- Available beds
- Occupied beds
- Patient status
3. Go to Rooms/Manage Beds to:
- Assign beds
- Mark rooms as occupied, available, or closed
4. Use Looker dashboards for:
- Historical occupancy trends
- Admission patterns
- Predictive analytics

Screenshots of working demo
- are in docs/ folder
  
Contribution list (who did what)

- Stella Goodrich
    - Login firebase implementation/management, login page, user documentation, poster, some frontend UI, github deployment & organization
- Jasmine Kue
   - Developed the navigation bar; built the frontend for the Dashboard, Insights, Patients, Manage Beds, and Manage Rooms pages; connected the UI to backend APIs; ensured real-time updates and accurate bed calculations; created and embedded Looker Studio visualizations.
- Jacob Schorr
   - GCP and database development, set up SQL database, cloud run, and eventrac. Lead developer for Backend functions including data transfer from frontend to GCP.


