import cv2
import mediapipe as mp
import numpy as np

mp_face_mesh = mp.solutions.face_mesh

LEFT_IRIS  = [474, 475, 476, 477]
RIGHT_IRIS = [469, 470, 471, 472]

cap = cv2.VideoCapture(0)

with mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
) as face_mesh:
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = face_mesh.process(rgb)
        rgb.flags.writeable = True
        frame = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

        if results.multi_face_landmarks:
            mesh_points = np.array([
                [int(p.x * w), int(p.y * h)]
                for p in results.multi_face_landmarks[0].landmark
            ])

            # Background blur using face convex hull as mask
            face_hull = cv2.convexHull(mesh_points)
            mask = np.zeros((h, w), dtype=np.uint8)
            cv2.fillConvexPoly(mask, face_hull, 255)
            blurred = cv2.GaussianBlur(frame, (99, 99), 0)
            frame = np.where(mask[..., None] == 255, frame, blurred)

            # Draw irises
            for side, indices, color in [
                ("Left",  LEFT_IRIS,  (0, 255, 0)),
                ("Right", RIGHT_IRIS, (255, 0, 0)),
            ]:
                pts = mesh_points[indices]
                center, radius = cv2.minEnclosingCircle(pts)
                cx, cy, r = int(center[0]), int(center[1]), int(radius)
                cv2.circle(frame, (cx, cy), r, color, 2)
                cv2.circle(frame, (cx, cy), 2, (0, 0, 255), -1)
                cv2.putText(frame, f"{side}: ({cx},{cy}) r={r}",
                            (10, 30 if side == "Left" else 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        else:
            # No face detected — blur everything
            frame = cv2.GaussianBlur(frame, (99, 99), 0)

        cv2.imshow("Iris Detection", frame)
        if cv2.waitKey(5) & 0xFF == ord("q"):
            break

cap.release()
cv2.destroyAllWindows()