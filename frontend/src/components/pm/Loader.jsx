import React from "react";
import styles from "./Loader.module.css";

const Loader = React.memo(function Loader() {
  return (
    <div className={styles.loaderWrap}>
      <div className={styles.blob} />
    </div>
  );
});

export default Loader;