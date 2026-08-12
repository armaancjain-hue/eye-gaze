import cv2
import mediapipe as mp
import numpy as np

mp_pose = mp.solutions.pose
mp_draw = mp.solutions.drawing_utils
mp_styles = mp.solutions.drawing_styles

cap = cv2.VideoCapture(0)

with mp_pose.Pose(
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
    enable_segmentation=True
) as pose:
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = pose.process(rgb)
        rgb.flags.writeable = True
        frame = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

        if results.segmentation_mask is not None:
            mask = results.segmentation_mask > 0.5
            blurred = cv2.GaussianBlur(frame, (99, 99), 0)
            frame = np.where(mask[..., None], frame, blurred)

        if results.pose_landmarks:
            mp_draw.draw_landmarks(
                frame,
                results.pose_landmarks,
                mp_pose.POSE_CONNECTIONS,
                landmark_drawing_spec=mp_styles.get_default_pose_landmarks_style()
            )
            lm = results.pose_landmarks.landmark
            h, w, _ = frame.shape
            nose = lm[mp_pose.PoseLandmark.NOSE]
            cv2.putText(frame, f"Nose: ({int(nose.x*w)}, {int(nose.y*h)})",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0,255 ), 2)

        cv2.imshow("Pose Detection", frame)
        if cv2.waitKey(5) & 0xFF == ord("q"):
            break

cap.release()
cv2.destroyAllWindows()