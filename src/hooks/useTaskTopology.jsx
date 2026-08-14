import { useMemo } from "react";
import { supabase } from "../lib/supabase";
import { useEffect } from "react";
import { useState } from "react";

export function useTaskTopology(isOpen, formData, taskCategoryId, isEditing) {
  const [topology, setTopology] = useState({ emps: [], cats: [] });
  const [isLoadingTop, setIsLoadingTop] = useState(false);

  useEffect(() => {
    if (isOpen && topology.cats.length === 0) {
      const fetchTop = async () => {
        setIsLoadingTop(true);
        const [empRes, catRes] = await Promise.all([
          supabase
            .from("employees")
            .select("id, name, department, sub_department")
            .neq("is_deleted", true),
          supabase
            .from("categories")
            .select("category_id, description, department, sub_department"),
        ]);
        setTopology({ emps: empRes?.data || [], cats: catRes.data || [] });
        setIsLoadingTop(false);
      };
      fetchTop();
    }
  }, [isOpen, topology.cats.length]);

  const uniqueDepts = useMemo(
    () =>
      [
        ...new Set(topology.cats.map((c) => c.department).filter(Boolean)),
      ].sort(),
    [topology.cats],
  );

  const uniqueSubDepts = useMemo(
    () =>
      [
        ...new Set(
          topology.cats
            .filter((c) => c.department === formData.department)
            .map((c) => c.sub_department)
            .filter(Boolean),
        ),
      ].sort(),
    [topology.cats, formData.department],
  );

  const filteredEmployees = useMemo(
    () =>
      topology.emps
        .filter(
          (e) =>
            e.department === formData.department &&
            e.sub_department === formData.subDepartment,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [topology.emps, formData.department, formData.subDepartment],
  );

  const filteredCategories = useMemo(() => {
    const targetSubDept = isEditing
      ? formData.subDepartment
      : topology.cats.find((c) => c.category_id === taskCategoryId)?.sub_department;

    return topology.cats.filter((cat) => {
      // 1. Does it match the currently selected sub-department?
      const isNormalMatch = cat.sub_department === targetSubDept;
      
      // 2. Is it one of your universal committee categories?
      const isUniversal = cat.department === "ALL" && cat.sub_department === "ALL";

      // Keep the category if it passes either test
      return isNormalMatch || isUniversal;
    });
  }, [topology.cats, formData.subDepartment, taskCategoryId, isEditing]);

  const taskOwnerInfo = useMemo(
    () => topology.emps.find((e) => e.id === formData.loggedById),
    [topology.emps, formData.loggedById],
  );

  return {
    isLoadingTop,
    uniqueDepts,
    uniqueSubDepts,
    filteredEmployees,
    filteredCategories,
    taskOwnerInfo,
    topology,
  };
}
